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

// 1. lock
let r = run(['lock', '--config', CFG]); t('lock 成功', r.code === 0, r.out.slice(-300));
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
// 3. 已跑過的不重跑：再跑一次 report 只重算
r = run(['report', '--config', CFG, '--out', outAll]); t('report 重算成功', r.code === 0);
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
// 7. baseline 模式（gauge.json 去掉 skill）
const g = readJ(CFG); delete g.skill; fs.writeFileSync(CFG, JSON.stringify(g, null, 2));
const outB = path.join(work, 'out-baseline');
r = run(['baseline', '--config', CFG, '--out', outB, '--runs', '1']);
t('baseline 模式可跑', r.code === 0 && fs.existsSync(path.join(outB, 'report.json')), r.out.slice(-400));

console.log(`\n${n - bad}/${n} 通過${bad ? '' : '；工作目錄 ' + work}`);
if (!bad) { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
else console.log(`（失敗，保留 ${work} 與 ${root} 供檢查）`);
process.exit(bad ? 1 : 0);
