#!/usr/bin/env node
// 端到端測試（假模型）：把教具複製到暫存目錄，用 stub-claude 走完 lock → all（含觸發、壓力題）→ matrix → describe → compare → html。
// 不打任何 API、CI 可跑。它驗的是「引擎每一段接得起來、檔案形狀對、關鍵判定對」，不是模型好不好。
//   node scripts/e2e-stub.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(here, 'gauge.mjs'), STUB = path.join(here, 'stub-claude.mjs');
const REPO = path.resolve(here, '..', '..', '..', '..');
const FIXTURE = path.join(REPO, 'exercises', 'fixtures', 'meeting-notes');
let n = 0, bad = 0; const t = (name, cond, extra = '') => { n++; if (!cond) { bad++; console.log('✗', name, extra); } else console.log('✓', name); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-e2e-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-e2e-root-'));
const fx = path.join(work, 'fixture');
fs.cpSync(FIXTURE, fx, { recursive: true });
const CFG = path.join(fx, 'gauge', 'gauge.json');
const env = { ...process.env, GAUGE_CLAUDE_CMD: `${process.execPath} ${STUB}` };
const run = (args, opts = {}) => { const r = spawnSync(process.execPath, [ENGINE, ...args, '--root', root], { env, encoding: 'utf8', ...opts }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// 1. lock：新鎖成功；已有鎖不准靜默覆寫；--relock 才行（並留舊鎖）；沒有 pre-registration.md 拒鎖
fs.rmSync(path.join(fx, 'gauge', 'lock.json'), { force: true });
fs.rmSync(path.join(fx, 'gauge', 'history.jsonl'), { force: true }); // 本機教具可能已有實跑歷史，測試從零開始
if (fs.existsSync(path.join(fx, 'gauge', 'runs'))) fs.rmSync(path.join(fx, 'gauge', 'runs'), { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(fx, 'gauge'))) if (f.startsWith('lock.prev-')) fs.rmSync(path.join(fx, 'gauge', f));
let r = run(['lock', '--config', CFG]); t('lock 成功', r.code === 0, r.out.slice(-300));
r = run(['lock', '--config', CFG]); t('已有 lock.json 時再 lock 被拒（不可靜默覆寫）', r.code !== 0 && /relock/.test(r.out));
r = run(['lock', '--config', CFG, '--relock']); t('--relock 成功且留下舊鎖', r.code === 0 && fs.readdirSync(path.join(fx, 'gauge')).some((f) => f.startsWith('lock.prev-')) && readJ(path.join(fx, 'gauge', 'lock.json')).relocks === 1);
{ const pre = path.join(fx, 'gauge', 'pre-registration.md'); const bak = pre + '.bak'; fs.renameSync(pre, bak); const rr = run(['lock', '--config', CFG, '--relock']); t('沒有 pre-registration.md 拒鎖', rr.code !== 0 && /pre-registration/.test(rr.out)); fs.renameSync(bak, pre); }
// 2. all --runs 1 --with-trigger（stub 的不帶 skill 組故意失兩條 → 不會 STOP）
const outAll = path.join(work, 'out-all');
r = run(['all', '--config', CFG, '--out', outAll, '--runs', '1', '--with-trigger']);
t('all 跑完（exit 0）', r.code === 0, r.out.slice(-600));
const rep = fs.existsSync(path.join(outAll, 'report.json')) ? readJ(path.join(outAll, 'report.json')) : null;
t('report.json 存在且 kind=report', !!rep && rep.kind === 'report');
t('停案規則＝CONTINUE（stub 不帶 skill 會失分）', rep?.baseline?.verdict === 'CONTINUE', JSON.stringify(rep?.baseline?.verdict));
t('帶 skill 組通過數 > 不帶', rep && rep.totals.with && rep.totals.without && rep.totals.with.pass > rep.totals.without.pass, JSON.stringify(rep?.totals));
t('壓力測試區塊存在、兩個情境', rep?.pressure?.scenarios?.length === 2);
const p4 = rep?.pressure?.scenarios.find((s) => s.case === 'case-04-pressure-comply');
t('壓力題：帶 skill 守住、不帶折了', p4 && p4.arms.with.held === 1 && p4.arms.without.violated === 1, JSON.stringify(p4?.arms));
t('合理化說詞逐字擷取檔存在', fs.existsSync(path.join(outAll, 'pressure-capture.json')) && readJ(path.join(outAll, 'pressure-capture.json')).some((c) => c.rationalizations.length));
// stub 刻意讓「standup／transcript」那題在目前的 description 下不觸發（描述優化迴圈才測得出差別）
t('觸發：該觸發 16 次裡 14 次（standup 題 2 次沒觸發）、不該觸發 0 誤觸發', rep?.trigger && rep.trigger.should.n === 16 && rep.trigger.should.fired === 14 && rep.trigger.shouldNot.fired === 0, JSON.stringify(rep?.trigger && { s: rep.trigger.should, n: rep.trigger.shouldNot }));
t('逐 run 明細含產出全文', Array.isArray(rep?.runs) && rep.runs.length === 15 && rep.runs.every((x) => typeof x.output === 'string'), String(rep?.runs?.length));
t('report.html 產出且含「先看這裡」', fs.existsSync(path.join(outAll, 'report.html')) && fs.readFileSync(path.join(outAll, 'report.html'), 'utf8').includes('先看這裡'));
t('history.jsonl 有一列', fs.existsSync(path.join(fx, 'gauge', 'history.jsonl')) && fs.readFileSync(path.join(fx, 'gauge', 'history.jsonl'), 'utf8').trim().split('\n').length === 1);
// 3. 已跑過的不重跑：再跑一次 report 只重算；history 同目錄不重複追加
r = run(['report', '--config', CFG, '--out', outAll]); t('report 重算成功', r.code === 0);
t('report 重算後 history 仍只有一列（同目錄更新不追加）', fs.readFileSync(path.join(fx, 'gauge', 'history.jsonl'), 'utf8').trim().split('\n').length === 1);
r = run(['run', '--config', CFG, '--out', outAll, '--runs', '1', '--effort', 'low']); t('同一輸出目錄換條件（effort）續跑被拒', r.code !== 0 && /別的條件/.test(r.out));
t('壓力說詞逐字檢查有標記', readJ(path.join(outAll, 'pressure-capture.json')).every((c) => Array.isArray(c.rationalizations_verbatim)));
// 4. matrix：兩格（用 --models 覆蓋成 stub 的兩個假模型名）
const outM = path.join(work, 'out-matrix');
r = run(['matrix', '--config', CFG, '--out', outM, '--runs', '1', '--models', 'stub-a,stub-b', '--efforts', 'low']);
t('matrix 跑完', r.code === 0, r.out.slice(-600));
const mx = fs.existsSync(path.join(outM, 'matrix.json')) ? readJ(path.join(outM, 'matrix.json')) : null;
t('matrix.json 兩格 done', mx && mx.combos.length === 2 && mx.combos.every((c) => c.status === 'done'), JSON.stringify(mx?.combos.map((c) => [c.slug, c.status])));
t('每格有自己的 report.html', mx && mx.combos.every((c) => fs.existsSync(path.join(outM, c.slug, 'report.html'))));
t('每格報告帶 effort=low', mx && mx.combos.every((c) => readJ(path.join(outM, c.slug, 'report.json')).conditions.executorEffort === 'low'));
t('matrix.html 產出', fs.existsSync(path.join(outM, 'matrix.html')));
r = run(['matrix-report', '--config', CFG, '--out', outM]); t('matrix-report 重算', r.code === 0 && fs.existsSync(path.join(outM, 'matrix.md')));
// 5. describe：一輪
const outD = path.join(work, 'out-describe');
r = run(['describe', '--config', CFG, '--out', outD, '--rounds', '1', '--runs', '1']);
t('describe 跑完', r.code === 0, r.out.slice(-600));
const ds = fs.existsSync(path.join(outD, 'describe.json')) ? readJ(path.join(outD, 'describe.json')) : null;
t('describe.json：兩輪（目前＋提案）、有 held-out', ds && ds.rounds.length === 2 && ds.split.test.length > 0 && ds.rounds[1].source === 'proposed', JSON.stringify(ds && { rounds: ds.rounds.length, test: ds.split.test.length }));
t('describe 提案輪比目前輪多過至少一題', ds && (ds.rounds[1].train.passed + (ds.rounds[1].test?.passed || 0)) > (ds.rounds[0].train.passed + (ds.rounds[0].test?.passed || 0)), JSON.stringify(ds?.rounds.map((r) => [r.train.passed + '/' + r.train.total, r.test && r.test.passed + '/' + r.test.total])));
t('describe 預設不寫回 SKILL.md', ds && ds.applied === false && !fs.readdirSync(path.join(fx, 'skill', 'meeting-notes')).some((f) => f.startsWith('SKILL.md.bak')));
t('describe.html 產出', fs.existsSync(path.join(outD, 'describe.html')));
// 6. compare（兩份 report 相減）
r = run(['compare', path.join(outAll, 'report.json'), path.join(outM, mx.combos[0].slug, 'report.json')]);
t('compare 可跑', r.code === 0 && /總判定/.test(r.out));
r = run(['history', '--config', CFG]); t('history 列表', r.code === 0 && /report/.test(r.out));
r = run(['html', '--out', outAll]); t('html 重出', r.code === 0);
// 7. 停案路徑：假模型「不帶 skill 也全對」→ STOP（exit 3）、一般題的帶 skill 組不跑，但壓力題／負向對照題的帶 skill 組照跑（安全探針）
const outS = path.join(work, 'out-stop');
r = spawnSync(process.execPath, [ENGINE, 'all', '--config', CFG, '--out', outS, '--runs', '1', '--root', root], { env: { ...env, GAUGE_STUB_MODE: 'perfect-baseline' }, encoding: 'utf8' });
t('停案：exit 3', r.status === 3, ((r.stdout || '') + (r.stderr || '')).slice(-400));
const repS = fs.existsSync(path.join(outS, 'report.json')) ? readJ(path.join(outS, 'report.json')) : null;
t('停案：baseline.verdict=STOP', repS?.baseline?.verdict === 'STOP');
t('停案：一般題的帶 skill 組沒跑、壓力題與負向對照題的帶 skill 組有跑（安全探針）', !fs.existsSync(path.join(outS, 'runs', 'case-01-trap', 'with')) && fs.existsSync(path.join(outS, 'runs', 'case-04-pressure-comply', 'with', 'r1', 'grading.json')) && fs.existsSync(path.join(outS, 'runs', 'case-03-negative', 'with', 'r1', 'meta.json')));
t('停案：壓力題三組都守住→旗標「零鑑別／基準組守住」而非「折了」', repS && repS.flags.some((f) => /零鑑別：case-04|基準組守住：case-04/.test(f)) && !repS.flags.some((f) => f.startsWith('壓力下折了')));
// 8. baseline 模式（gauge.json 去掉 skill）
const g = readJ(CFG); delete g.skill; fs.writeFileSync(CFG, JSON.stringify(g, null, 2));
const outB = path.join(work, 'out-baseline');
r = run(['baseline', '--config', CFG, '--out', outB, '--runs', '1']);
t('baseline 模式可跑', r.code === 0 && fs.existsSync(path.join(outB, 'report.json')), r.out.slice(-400));

console.log(`\n${n - bad}/${n} 通過`);
if (!bad) { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
else console.log(`（失敗，保留 ${work} 與 ${root} 供檢查）`);
process.exit(bad ? 1 : 0);
