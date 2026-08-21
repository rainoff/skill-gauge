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
// 1b. preview：核可頁——未鎖定／已鎖定／不一致三態；不需要 claude 也能出
{
  const lockPath = path.join(fx, 'gauge', 'lock.json');
  const savedLock = fs.readFileSync(lockPath); // 這時已經是上面 --relock 後的鎖定狀態
  fs.rmSync(lockPath);
  const outBefore = path.join(work, 'preview-before.html');
  r = run(['preview', '--config', CFG, '--out', outBefore]);
  const htmlBefore = fs.existsSync(outBefore) ? fs.readFileSync(outBefore, 'utf8') : '';
  t('preview（未鎖定）exit 0，提到未鎖定／meeting-notes／成本估算', r.code === 0 && /未鎖定/.test(htmlBefore) && /meeting-notes/.test(htmlBefore) && /成本估算/.test(htmlBefore), r.out.slice(-300));
  fs.writeFileSync(lockPath, savedLock);
  const outLocked = path.join(work, 'preview.html');
  r = run(['preview', '--config', CFG, '--out', outLocked]);
  const htmlLocked = fs.existsSync(outLocked) ? fs.readFileSync(outLocked, 'utf8') : '';
  t('preview（已鎖定）exit 0，提到已鎖定', r.code === 0 && /已鎖定/.test(htmlLocked), r.out.slice(-300));
  t('preview v2：三問卡在頁首（位置先於量測概覽）、教具頁無「翻車」', /你要回答的三個問題/.test(htmlLocked) && htmlLocked.indexOf('你要回答的三個問題') < htmlLocked.indexOf('量測概覽') && !/翻車/.test(htmlLocked));
  t('preview v2（critic 🔴1 完整版）：教具三組——臂名句、確認③「各組」、無「兩組拿到」與「兩組共用的指令」；prereg 齊全走通行尾句', /3 組（with／without／reminder）拿到的是逐字相同/.test(htmlLocked) && /前置檢查各組都做得到/.test(htmlLocked) && !/兩組拿到的是逐字相同/.test(htmlLocked) && !/兩組共用的指令/.test(htmlLocked) && /適用的確認都成立/.test(htmlLocked));
  const promptPath = path.join(fx, 'gauge', 'case-01-trap.prompt.md');
  const savedPrompt = fs.readFileSync(promptPath, 'utf8');
  fs.writeFileSync(promptPath, savedPrompt + '\n\n（e2e 測試改動）');
  const outMismatch = path.join(work, 'preview-mismatch.html');
  r = run(['preview', '--config', CFG, '--out', outMismatch]);
  const htmlMismatch = fs.existsSync(outMismatch) ? fs.readFileSync(outMismatch, 'utf8') : '';
  t('preview（改動後）exit 0，顯示不一致', r.code === 0 && /不一致/.test(htmlMismatch), r.out.slice(-300));
  fs.writeFileSync(promptPath, savedPrompt);
  const rNoClaude = spawnSync(process.execPath, [ENGINE, 'preview', '--config', CFG, '--out', path.join(work, 'preview-noclaude.html')], { env: { ...process.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  t('preview 不用 claude 也能跑（PATH 裡沒有 claude 一樣過）', rNoClaude.status === 0, ((rNoClaude.stdout || '') + (rNoClaude.stderr || '')).slice(-300));
}
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
t('report.md 開頭是「決策摘要」，「原始摘要（深究用）」段不含檢查項 id；report.html 決策摘要在最前', (() => { const md = fs.readFileSync(path.join(outAll, 'report.md'), 'utf8'); const dfi = md.indexOf('## 決策摘要'); const i = md.indexOf('## 原始摘要（深究用）'), j = md.indexOf('## 先看這裡'); const seg = md.slice(i, j); const h = fs.readFileSync(path.join(outAll, 'report.html'), 'utf8'); return dfi >= 0 && i > dfi && j > i && /有沒有幫上忙/.test(seg) && !/fact-no-invented-deadline|judgment-/.test(seg) && h.indexOf('決策摘要') < h.indexOf('原始摘要（深究用）') && h.indexOf('原始摘要（深究用）') < h.indexOf('先看這裡'); })());
t('決策摘要 v2：七行固定版型（結論／成功率／情境地圖／效果／穩度／成本／邊界）都在，順序照寫死的來', (() => { const d = rep?.decisionFirst || []; return ['【結論】', '【成功率】', '【情境地圖】', '【效果】', '【穩度】', '【成本】', '【邊界】'].every((tag) => d.some((l) => l.startsWith(tag))) && d.findIndex((l) => l.startsWith('【成功率】')) === 1; })(), JSON.stringify(rep?.decisionFirst?.map((l) => l.slice(0, 6))));
t('決策摘要 v2：主敘事是場景全對率（AI 評分）＋原始計數，不是格數', /^【成功率】場景全對（AI 評分）：帶 \d+\/\d+（\d+%） vs 不帶 \d+\/\d+（\d+%）/.test(rep?.decisionFirst?.[1] || ''), rep?.decisionFirst?.[1]);
t('決策摘要 v2：三路線建議段（改 skill／改用法／發掘）各出一行', ['【建議·改 skill】', '【建議·改用法】', '【建議·發掘】'].every((tag) => (rep?.decisionFirst || []).some((l) => l.startsWith(tag))));
t('決策摘要 v2：成本行印出決策矩陣門檻字樣；邊界行帶單 skill 隔離句', /門檻：每次全對的成本差 ≥20% 視為顯著（經驗值，未校準）/.test((rep?.decisionFirst || []).find((l) => l.startsWith('【成本】')) || '') && /單 skill 隔離/.test((rep?.decisionFirst || []).find((l) => l.startsWith('【邊界】')) || ''));
t('環節效益表：report.json／report.md／report.html 三處都有', !!rep?.benefit?.rows?.length && fs.readFileSync(path.join(outAll, 'report.md'), 'utf8').includes('## 環節效益表') && fs.readFileSync(path.join(outAll, 'report.html'), 'utf8').includes('環節效益表'));
t('深究成本表：Markdown 與 HTML 都有同一組分子分母（場景全對／有效但未成功／無法判定／前置作廢）', (() => { const md = fs.readFileSync(path.join(outAll, 'report.md'), 'utf8'); const h = fs.readFileSync(path.join(outAll, 'report.html'), 'utf8'); return /### 深究：成本派生欄/.test(md) && /場景全對（AI 評分）/.test(md) && /有效但未成功/.test(md) && /深究：成本派生欄/.test(h) && /場景全對（AI 評分）/.test(h); })());
t('公開字串沒有殘留舊詞彙（判定通過／每成功成本／無成功 run／機械層全過／翻車）', (() => { const md = fs.readFileSync(path.join(outAll, 'report.md'), 'utf8'); const h = fs.readFileSync(path.join(outAll, 'report.html'), 'utf8'); const pg = fs.readFileSync(path.join(outAll, 'page.html'), 'utf8'); return !/判定通過|每成功成本|無成功 run|機械層全過|翻車/.test(md + h + pg); })());
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
t('停案：決策摘要照 v2 版型出七行，成功率／情境地圖都改「未完成同題組同次數的兩臂比較」', (() => { const d = repS?.decisionFirst || []; const pick = (tag) => d.find((l) => l.startsWith(tag)) || ''; return ['【結論】', '【成功率】', '【情境地圖】', '【效果】', '【穩度】', '【成本】', '【邊界】'].every((tag) => pick(tag)) && /未完成同題組同次數的兩臂比較/.test(pick('【成功率】')) && /未完成同題組同次數的兩臂比較/.test(pick('【情境地圖】')); })(), JSON.stringify(repS?.decisionFirst));
t('停案：成本行標「效率價值未判」，且全文不出現「只跑了基準組」「成本臂」', (() => { const d = (repS?.decisionFirst || []).join(''); return /效率價值未判/.test(d) && !/只跑了基準組/.test(d) && !/成本臂/.test(d); })());
t('停案：屬量測層問題→建議段出「改題目」，三路線退誠實句', (() => { const d = repS?.decisionFirst || []; return d.some((l) => l.startsWith('【建議·改題目】')) && d.some((l) => /^【建議·改 skill】未完成同題組同次數的兩臂比較/.test(l)); })());
// 9b. 覆寫執法（critic 新 🔴 補齊後的管線已知答案）：--effort／--judge-model 與核可不同 → 報告旗標
{
  const outEff = path.join(work, 'out-eff');
  const re = run(['all', '--config', CFG, '--out', outEff, '--runs', '1', '--effort', 'low', '--judge-model', 'stub-judge']);
  const repE = fs.existsSync(path.join(outEff, 'report.json')) ? readJ(path.join(outEff, 'report.json')) : null;
  t('覆寫執法：--effort 與 --judge-model 偏離核可 → 各得一支「與核可不同」旗標', re.code === 0 && !!repE && repE.flags.some((f) => /effort與核可不同/.test(f) && /--effort 覆寫/.test(f)) && repE.flags.some((f) => /評分模型與核可不同/.test(f) && /--judge-model 覆寫/.test(f)), JSON.stringify(repE?.flags?.filter((f) => /核可不同/.test(f))));
  t('覆寫執法：CLI 執行當下印 ⚠ 警告（effort＋judge-model 各一行）——契約句「執行當下會印警告」的護欄', /⚠ --effort low 跟核可的/.test(re.out) && /⚠ --judge-model stub-judge 跟核可的/.test(re.out), re.out.slice(0, 400));
  t('覆寫執法：page.html 結論卡帶「試跑口徑」警語（3 項與核可不同）', fs.existsSync(path.join(outEff, 'page.html')) && /試跑口徑：3 項執行條件與核可不同/.test(fs.readFileSync(path.join(outEff, 'page.html'), 'utf8')));
  t('覆寫執法（陰性）：主跑（無 effort／模型覆寫）沒有那兩支旗標', !!rep && !(rep.flags || []).some((f) => /effort與核可不同|評分模型與核可不同|執行模型與核可不同/.test(f)));
  const outMx = path.join(work, 'out-mx-temp');
  const rm2 = run(['matrix', '--config', CFG, '--out', outMx, '--models', 'stub-x', '--efforts', 'low', '--runs', '1']);
  const cellDirs = fs.existsSync(outMx) ? fs.readdirSync(outMx, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
  const cellRep = cellDirs.length ? readJ(path.join(outMx, cellDirs[0].name, 'report.json')) : null;
  t('覆寫執法（critic 三輪 🔴）：--models 臨時格＝逐格「矩陣格與核可不同」旗標＋CLI 警告', rm2.code === 0 && /⚠ --models／--efforts 是臨時格/.test(rm2.out) && !!cellRep && cellRep.flags.some((f) => /矩陣格與核可不同/.test(f) && /stub-x/.test(f)), JSON.stringify(cellRep?.flags?.filter((f) => /矩陣格/.test(f))) + rm2.out.slice(-200));
  // critic 四輪 🔴 陰性：核可網格用「省略 executorModel」與「model 別名」的標準寫法——解析後比對，不得誤標臨時格
  const fxm = path.join(work, 'fixture-mx');
  fs.cpSync(FIXTURE, fxm, { recursive: true });
  const CFGM = path.join(fxm, 'gauge', 'gauge.json');
  for (const f of ['lock.json', 'history.jsonl']) fs.rmSync(path.join(fxm, 'gauge', f), { force: true });
  if (fs.existsSync(path.join(fxm, 'gauge', 'runs'))) fs.rmSync(path.join(fxm, 'gauge', 'runs'), { recursive: true, force: true });
  for (const f of fs.readdirSync(path.join(fxm, 'gauge'))) if (f.startsWith('lock.prev-')) fs.rmSync(path.join(fxm, 'gauge', f));
  { const gm = readJ(CFGM); gm.matrix = [{ effort: 'low' }, { model: gm.executorModel }]; fs.writeFileSync(CFGM, JSON.stringify(gm, null, 2)); }
  let rmx = run(['lock', '--config', CFGM]); t('矩陣陰性：省略式網格 lock 成功', rmx.code === 0, rmx.out.slice(-200));
  const outMxA = path.join(work, 'out-mx-approved');
  rmx = run(['matrix', '--config', CFGM, '--out', outMxA, '--runs', '1']);
  const mxCells = fs.existsSync(outMxA) ? fs.readdirSync(outMxA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => readJ(path.join(outMxA, e.name, 'report.json'))) : [];
  t('矩陣陰性（critic 四輪 🔴）：省略 executorModel／model 別名的核可格——零「矩陣格與核可不同」旗標、零臨時格警告、page 試跑口徑恰為 1 項（只有 --runs，矩陣零貢獻）', rmx.code === 0 && mxCells.length === 2 && mxCells.every((r2) => !(r2.flags || []).some((f) => /矩陣格與核可不同/.test(f))) && !/是臨時格/.test(rmx.out) && fs.readdirSync(outMxA, { withFileTypes: true }).filter((e) => e.isDirectory()).every((e) => /試跑口徑：1 項執行條件與核可不同/.test(fs.readFileSync(path.join(outMxA, e.name, 'page.html'), 'utf8'))), JSON.stringify(mxCells.map((r2) => (r2.flags || []).filter((f) => /矩陣格|核可不同/.test(f)))) + rmx.out.slice(-200));
  const outMxE = path.join(work, 'out-mx-equal');
  const rme = run(['matrix', '--config', CFGM, '--out', outMxE, '--models', String(readJ(CFGM).executorModel), '--runs', '1']);
  const eqCells = fs.existsSync(outMxE) ? fs.readdirSync(outMxE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => readJ(path.join(outMxE, e.name, 'report.json'))) : [];
  t('矩陣（critic 四輪 🟡）：臨時格恰等於核可格——CLI 有警告、零矩陣格旗標（契約句的限定為真）', rme.code === 0 && /是臨時格/.test(rme.out) && eqCells.length === 1 && !(eqCells[0].flags || []).some((f) => /矩陣格與核可不同/.test(f)));
  const rmeff = run(['matrix', '--config', CFGM, '--out', path.join(work, 'out-mx-eff'), '--runs', '1', '--effort', 'low']);
  t('矩陣（critic 四輪 🟡）：--effort 在 matrix 印「不生效」誠實警告、不再宣稱「報告會標記」', /⚠ --effort 在 matrix 不生效/.test(rmeff.out) && !/--effort low 跟核可的/.test(rmeff.out));
}
// 8. baseline 模式（gauge.json 去掉 skill）
const g = readJ(CFG); delete g.skill; fs.writeFileSync(CFG, JSON.stringify(g, null, 2));
const outB = path.join(work, 'out-baseline');
r = run(['baseline', '--config', CFG, '--out', outB, '--runs', '1']);
t('baseline 模式可跑', r.code === 0 && fs.existsSync(path.join(outB, 'report.json')), r.out.slice(-400));

// 9. 外掛揭露（1.2.1＋R1 修正）：fixture 包進外掛結構 → 邊界句（證據級措辭）；帶 payload 的停案結論出低估警語；
//    陰性＝第一個 fixture 不出外掛句；R1-1＝html 重出走儲存行、1.2.0 形態逐字保真
t('外掛揭露（陰性）：非外掛 fixture 的邊界行不出現外掛句', !/外掛/.test((rep?.decisionFirst || []).find((l) => l.startsWith('【邊界】')) || ''));
{
  // R1-1：把現成 report.json 削成 1.2.0 形態（刪 subjectPlugin），用 render CLI 重出 → 邊界行逐字不變
  const repOld = readJ(path.join(outAll, 'report.json'));
  delete repOld.subjectPlugin;
  const oldJ = path.join(work, 'old-style-report.json'); fs.writeFileSync(oldJ, JSON.stringify(repOld));
  const oldH = path.join(work, 'old-style-report.html');
  const rr = spawnSync(process.execPath, [path.join(here, 'render.mjs'), oldJ, oldH], { encoding: 'utf8' });
  const oldBoundary = (repOld.decisionFirst || []).find((l) => l.startsWith('【邊界】')) || '';
  const oldHtml = fs.existsSync(oldH) ? fs.readFileSync(oldH, 'utf8') : '';
  t('外掛揭露（R1-1）：1.2.0 形態 report.json 經 html 重出，儲存的邊界行原樣出現、無外掛句', rr.status === 0 && oldBoundary.endsWith('不反映多 skill 併存時的觸發表現。') && oldHtml.includes(oldBoundary) && !/另外，受測 skill/.test(oldHtml));
}
const fx2 = path.join(work, 'fixture-plugin');
fs.cpSync(FIXTURE, fx2, { recursive: true });
const CFG2 = path.join(fx2, 'gauge', 'gauge.json');
for (const f of ['lock.json', 'history.jsonl']) fs.rmSync(path.join(fx2, 'gauge', f), { force: true });
if (fs.existsSync(path.join(fx2, 'gauge', 'runs'))) fs.rmSync(path.join(fx2, 'gauge', 'runs'), { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(fx2, 'gauge'))) if (f.startsWith('lock.prev-')) fs.rmSync(path.join(fx2, 'gauge', f));
fs.mkdirSync(path.join(fx2, '.claude-plugin'), { recursive: true });
fs.writeFileSync(path.join(fx2, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture-plugin', version: '0.0.1', skills: ['./skill/'] }));
fs.mkdirSync(path.join(fx2, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(fx2, 'hooks', 'hooks.json'), '{}');
fs.writeFileSync(path.join(fx2, '.mcp.json'), '{}');
let rp = run(['lock', '--config', CFG2]); t('外掛揭露：lock 成功', rp.code === 0, rp.out.slice(-300));
const outP = path.join(work, 'out-plugin');
rp = run(['all', '--config', CFG2, '--out', outP, '--runs', '1']);
t('外掛揭露：all 跑完（exit 0）', rp.code === 0, rp.out.slice(-400));
const repP = fs.existsSync(path.join(outP, 'report.json')) ? readJ(path.join(outP, 'report.json')) : null;
t('外掛揭露：report.json 記 subjectPlugin（root＋hooks＋MCP＋skills 範圍內）', repP?.subjectPlugin?.pluginRoot?.endsWith('fixture-plugin') === true && repP.subjectPlugin.hasHooks === true && repP.subjectPlugin.hasMcp === true && repP.subjectPlugin.skillsScope === true, JSON.stringify(repP?.subjectPlugin));
t('外掛揭露：決策摘要邊界行含範圍內強句（是外掛…的一部分＋低估甚至測不到）', /另外，受測 skill 是外掛 fixture-plugin 的一部分/.test((repP?.decisionFirst || []).find((l) => l.startsWith('【邊界】')) || '') && /低估甚至測不到/.test((repP?.decisionFirst || []).find((l) => l.startsWith('【邊界】')) || ''));
t('外掛揭露：report.md 也含同一句', fs.existsSync(path.join(outP, 'report.md')) && /是外掛 fixture-plugin 的一部分/.test(fs.readFileSync(path.join(outP, 'report.md'), 'utf8')));
const outPS = path.join(work, 'out-plugin-stop');
const rps = spawnSync(process.execPath, [ENGINE, 'all', '--config', CFG2, '--out', outPS, '--runs', '1', '--root', root], { env: { ...env, GAUGE_STUB_MODE: 'perfect-baseline' }, encoding: 'utf8' });
const repPS = fs.existsSync(path.join(outPS, 'report.json')) ? readJ(path.join(outPS, 'report.json')) : null;
t('外掛揭露：帶 payload 的停案（STOP）結論行出低估警語', rps.status === 3 && /「沒必要」可能是低估的誤判/.test(repPS?.decisionFirst?.[0] || ''), (repPS?.decisionFirst?.[0] || '') + ((rps.stdout || '') + (rps.stderr || '')).slice(-200));

// 10. v1.3 給人看的一頁（page.html）
t('page：all 產出 page.html——assertion id 與 case id 全不出現、無相似度字樣、有誰能動手與界線句', fs.existsSync(path.join(outAll, 'page.html')) && (() => { const h = fs.readFileSync(path.join(outAll, 'page.html'), 'utf8'); const ids = [...Object.keys(rep.assertions || {}), ...(rep.cases || []).map((c) => c.id)]; return ids.every((id) => !h.includes(id)) && !/相似度|scored-population|環節效益表/.test(h) && /誰能動手/.test(h) && /這一頁不代答/.test(h) && /正式讀數/.test(h); })());
t('page（MF-1）：停案報告的 page.html 印停案理由、不出「正式讀數」', (() => { const pth = path.join(outPS, 'page.html'); if (!fs.existsSync(pth)) return false; const h = fs.readFileSync(pth, 'utf8'); return /停案/.test(h) && !/正式讀數/.test(h); })());
t('page：html 重出也出 page.html', (() => { const d = path.join(work, 'html-redo'); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(path.join(outAll, 'report.json'), path.join(d, 'report.json')); const rr = run(['html', '--out', d]); return rr.code === 0 && fs.existsSync(path.join(d, 'page.html')); })());
t('page：舊報告（無 personPage）→ 誠實缺頁句，不捏造', (() => { const d = path.join(work, 'html-old'); fs.mkdirSync(d, { recursive: true }); const o = readJ(path.join(outAll, 'report.json')); delete o.personPage; delete o.decisionFirstData; fs.writeFileSync(path.join(d, 'report.json'), JSON.stringify(o)); const rr = run(['html', '--out', d]); const h = fs.existsSync(path.join(d, 'page.html')) ? fs.readFileSync(path.join(d, 'page.html'), 'utf8') : ''; return rr.code === 0 && /這一頁出不來/.test(h); })());

console.log(`\n${n - bad}/${n} 通過`);
if (!bad) { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
else console.log(`（失敗，保留 ${work} 與 ${root} 供檢查）`);
process.exit(bad ? 1 : 0);
