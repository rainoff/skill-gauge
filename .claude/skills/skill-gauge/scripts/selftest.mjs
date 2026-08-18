#!/usr/bin/env node
// 引擎自我測試（不呼叫模型、幾秒跑完）：純函式與報告數學。 node scripts/selftest.mjs
process.env.GAUGE_NO_MAIN = '1';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { ancestorsWithClaude, bigramDice, compareReports, extractJSONArray, parseArgs, summarizeTrigger, splitTrainTest, getDescription, setDescription, extractPressure, buildMatrix, matrixMarkdown, slugify, lastTwoComparable, pressureHeldText, describeMarkdown } = await import('./gauge.mjs');
let n = 0, bad = 0; const t = (name, cond) => { n++; if (!cond) { bad++; console.log('✗', name); } else console.log('✓', name); };

// 祖先掃描：有 .claude 的上層要被抓到，自己這層不算
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-selftest-'));
const withClaude = path.join(tmp, 'a'); fs.mkdirSync(path.join(withClaude, '.claude'), { recursive: true });
const deep = path.join(withClaude, 'b', 'c'); fs.mkdirSync(deep, { recursive: true });
t('祖先掃描抓到上層 .claude', ancestorsWithClaude(deep).includes(withClaude));
t('祖先掃描不算自己這層', !ancestorsWithClaude(withClaude).includes(withClaude));

// 相似度：自己比自己＝1；完全不同 <0.2；已知答案
t('相似度自比為 1', bigramDice('會議記錄 abc', '會議記錄 abc') === 1);
t('相似度全異接近 0', bigramDice('甲乙丙丁', 'wxyz1234') < 0.2);

// JSON 抽取：夾在文字裡也抓得到；壞 JSON 回 null
t('抽 JSON 陣列', JSON.stringify(extractJSONArray('好的：[{"id":"a","pass":true,"evidence":"x"}] 完')) === '[{"id":"a","pass":true,"evidence":"x"}]');
t('壞 JSON 回 null', extractJSONArray('[{"id":') === null);

// 參數解析
const a = parseArgs(['all', '--config', 'g.json', '--with-trigger', '--runs', '2']);
t('parseArgs 旗標與值', a._[0] === 'all' && a.config === 'g.json' && a['with-trigger'] === true && a.runs === '2');

// 回歸比較：已知答案（一條退步、一條進步、一條持平）
const mk = (p, effort = null) => ({ arms: ['with', 'without'], baseline: { arm: 'without' }, assertions: { x: { arms: { with: { pass: p[0], total: 3 } } }, y: { arms: { with: { pass: p[1], total: 3 } } }, z: { arms: { with: { pass: p[2], total: 3 } } } }, totals: { with: { pass: p[0] + p[1] + p[2], total: 9 } }, conditions: { executorModel: 'm', executorEffort: effort }, lock: { lockedAt: 'L' } });
const c = compareReports(mk([3, 1, 2]), mk([2, 2, 2]));
t('compare 逐條判定', c.rows.find((r) => r.id === 'x').verdict === 'regressed' && c.rows.find((r) => r.id === 'y').verdict === 'improved' && c.rows.find((r) => r.id === 'z').verdict === 'held');
t('compare 任一退步＝總判定退步', c.overall === 'regressed');
t('compare 同鎖定同模型偵測', c.sameConditions === true);
t('compare effort 不同＝條件不同', compareReports(mk([3, 1, 2], 'low'), mk([3, 1, 2], 'high')).sameConditions === false);

// 敏感度數學：差 D 格 → 抹平 |D|、反轉 |D|+1
const D = 12 - 10; t('敏感度：抹平 2、反轉 3', Math.abs(D) === 2 && Math.abs(D) + 1 === 3);

// 觸發彙整：逐 query 多數決；該觸發有觸發＝過、不該觸發沒觸發＝過
const rows = [
  { kind: 'should', query: 'q1', run: 1, fired: true, ok: true }, { kind: 'should', query: 'q1', run: 2, fired: false, ok: true }, { kind: 'should', query: 'q1', run: 3, fired: true, ok: true },
  { kind: 'should', query: 'q2', run: 1, fired: false, ok: true }, { kind: 'should', query: 'q2', run: 2, fired: false, ok: true }, { kind: 'should', query: 'q2', run: 3, fired: true, ok: true },
  { kind: 'shouldNot', query: 'n1', run: 1, fired: false, ok: true }, { kind: 'shouldNot', query: 'n1', run: 2, fired: true, ok: true }, { kind: 'shouldNot', query: 'n1', run: 3, fired: false, ok: true },
  { kind: 'shouldNot', query: 'n2', run: 1, fired: true, ok: false },
];
const ts = summarizeTrigger(rows);
t('觸發彙整：失敗 run 不計', ts.shouldNot.n === 3 && ts.should.n === 6);
t('觸發彙整：逐 query 多數決（q1 過、q2 不過、n1 過）', ts.perQuery.find((q) => q.query === 'q1').pass && !ts.perQuery.find((q) => q.query === 'q2').pass && ts.perQuery.find((q) => q.query === 'n1').pass && ts.queriesPassed === 2 && ts.queriesTotal === 3);
t('觸發彙整：recall 3/6、誤觸發 1/3', Math.abs(ts.recall - 3 / 6) < 1e-9 && Math.abs(ts.falseTriggerRate - 1 / 3) < 1e-9);

// train／test 切分：分層、固定 seed 可重現、held-out 至少各一題、不重疊
const S = ['s1', 's2', 's3', 's4', 's5'], N = ['n1', 'n2', 'n3', 'n4', 'n5'];
const sp1 = splitTrainTest(S, N, 0.4), sp2 = splitTrainTest(S, N, 0.4);
t('切分可重現（同 seed 同結果）', JSON.stringify(sp1) === JSON.stringify(sp2));
t('切分：held-out 該觸發 2、不該觸發 2', sp1.test.should.length === 2 && sp1.test.shouldNot.length === 2 && sp1.train.should.length === 3 && sp1.train.shouldNot.length === 3);
t('切分不重疊、不遺漏', [...sp1.train.should, ...sp1.test.should].sort().join() === S.join() && [...sp1.train.shouldNot, ...sp1.test.shouldNot].sort().join() === N.join());
t('切分：holdout 0＝全 train', splitTrainTest(S, N, 0).test.should.length === 0);
t('切分：只有兩題也留一題 held-out', splitTrainTest(['a', 'b'], ['c', 'd'], 0.4).test.should.length === 1);

// frontmatter description 讀寫：單行、引號、多行摺疊；寫回只動 description
const md1 = '---\nname: x\ndescription: 單行描述，含「引號」\n---\n\n# 內文\n';
t('讀 description 單行', getDescription(md1) === '單行描述，含「引號」');
const md2 = '---\nname: x\ndescription: >-\n  第一段\n  第二段\nallowed-tools: Read\n---\n內文';
t('讀 description 多行摺疊', getDescription(md2) === '第一段 第二段');
const md3 = setDescription(md2, '新的 "描述"');
t('寫 description 只動那一欄', md3.startsWith('---\nname: x\ndescription: "新的 \\"描述\\""\nallowed-tools: Read\n---\n') && md3.endsWith('內文') && getDescription(md3) === '新的 "描述"');
t('沒有 description 也能加', getDescription(setDescription('---\nname: y\n---\n', 'd')) === 'd');

// 壓力測試判定抽取：held → 守住那條 pass；violated → 不 pass＋擷取說詞；inconclusive → 那條缺席（當 harness failure）
const kase = { id: 'p1', type: 'pressure', rule: 'R', expectedBehavior: 'comply', __heldId: 'held:p1', expectedOption: 'A' };
const e1 = extractPressure([{ id: 'x', pass: true, evidence: 'e' }, { id: '__pressure__', verdict: 'held', chosenOption: 'A', rationalizations: [], pressuresThatWorked: [], citedSkill: true, note: 'ok' }], kase);
t('壓力 held → 守住條 pass、__pressure__ 移除', e1.arr.length === 2 && e1.arr.find((v) => v.id === 'held:p1').pass === true && !e1.arr.find((v) => v.id === '__pressure__') && e1.pressure.verdict === 'held' && e1.pressure.citedSkill === true);
const e2 = extractPressure([{ id: 'x', pass: true, evidence: 'e' }, { id: 'held:p1', pass: true, evidence: '評分者說過' }, { id: '__pressure__', verdict: 'violated', chosenOption: 'C', rationalizations: ['先寫上去之後再改'], pressuresThatWorked: ['時間'] }], kase);
t('壓力 violated → 守住條改為不 pass（以 verdict 為準）＋說詞擷取', e2.arr.find((v) => v.id === 'held:p1').pass === false && e2.pressure.rationalizations[0] === '先寫上去之後再改' && e2.pressure.pressuresThatWorked[0] === '時間');
const e3 = extractPressure([{ id: 'x', pass: true, evidence: 'e' }, { id: '__pressure__', verdict: 'inconclusive' }], kase);
t('壓力 inconclusive → 守住條缺席（不算分）', !e3.arr.find((v) => v.id === 'held:p1') && e3.pressure.verdict === 'inconclusive');
t('壓力：沒有 __pressure__ 就原樣回傳', extractPressure([{ id: 'x', pass: true }], kase).pressure === null);
t('壓力守住句：exempt 版提到「不適用」', /不適用/.test(pressureHeldText({ rule: 'R', expectedBehavior: 'exempt' })) && /守住/.test(pressureHeldText({ rule: 'R', expectedBehavior: 'comply' })));

// 矩陣：slug、併表（用假的 report.json 目錄）
t('slug 只留安全字元', slugify('claude-sonnet-5@high') === 'claude-sonnet-5-high' && slugify('a b/c') === 'a-b-c');
const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-matrix-'));
const fakeReport = (delta, stop) => ({ totals: { with: { pass: 10 + delta, total: 12 }, without: { pass: 10, total: 12 } }, sensitivity: { delta, flipsToReverse: Math.abs(delta) + 1 }, baseline: { verdict: stop ? 'STOP' : 'CONTINUE' }, flags: stop ? ['零鑑別：x'] : [], cost: { with: { medianDurationS: 10, medianOutputTokens: 500, medianCostUsd: 0.01, models: ['m'] }, without: { medianDurationS: 9, medianOutputTokens: 400, medianCostUsd: 0.01, models: ['m'] } }, assertions: { x: { arms: { with: { pass: 3, total: 3 }, without: { pass: 2, total: 3 } } } } });
for (const [slug, d, s] of [['m1-default', 2, false], ['m2-low', 0, true]]) { fs.mkdirSync(path.join(mdir, slug), { recursive: true }); fs.writeFileSync(path.join(mdir, slug, 'report.json'), JSON.stringify(fakeReport(d, s))); }
const cfgFake = { name: 'fx', judgeModel: 'j', runs: 2, arms: [{ name: 'with' }, { name: 'without' }], assertions: [{ id: 'x', family: 'fact' }, { id: 'g', family: 'gate' }] };
const mx = buildMatrix(cfgFake, mdir, [{ slug: 'm1-default', executorModel: 'm1', effort: null }, { slug: 'm2-low', executorModel: 'm2', effort: 'low' }, { slug: 'm3-missing', executorModel: 'm3', effort: null }]);
t('矩陣併表：done／stopped／failed 三態', mx.combos[0].status === 'done' && mx.combos[1].status === 'stopped' && mx.combos[2].status === 'failed');
t('矩陣併表：只列計分檢查項', mx.assertionIds.join() === 'x' && mx.combos[0].assertions.x.with.pass === 3);
const mmd = matrixMarkdown(mx);
t('矩陣 markdown 有總表與逐條表', /m1-default/.test(mmd) && /逐條檢查項 × 格/.test(mmd) && /STOP/.test(mmd));

// 歷史：最近兩次同條件（同模型、同 effort、同鎖定）
fs.mkdirSync(path.join(mdir, 'm1-again'), { recursive: true }); fs.writeFileSync(path.join(mdir, 'm1-again', 'report.json'), JSON.stringify(fakeReport(1, false)));
const hist = [
  { kind: 'report', outDir: path.join(mdir, 'm1-default'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1' },
  { kind: 'report', outDir: path.join(mdir, 'm2-low'), executorModel: 'a', effort: 'low', judgeModel: 'j', lockedAt: 'L1' },
  { kind: 'baseline', outDir: path.join(mdir, 'm1-default'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1' },
  { kind: 'report', outDir: path.join(mdir, 'm1-again'), executorModel: 'a', effort: null, judgeModel: 'j2', lockedAt: 'L1' },
  { kind: 'report', outDir: path.join(mdir, 'm1-again'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1' },
];
const pair = lastTwoComparable(hist);
t('歷史配對：跳過 effort／評分模型不同與 baseline、同目錄，取最近兩次同條件', pair && pair[0] === hist[0] && pair[1] === hist[4]);
t('歷史配對：找不到回 null', lastTwoComparable([hist[0], hist[1]]) === null);
t('compare：評分模型不同＝條件不同', compareReports({ ...mk([3, 1, 2]), conditions: { executorModel: 'm', judgeModel: 'j1' } }, { ...mk([3, 1, 2]), conditions: { executorModel: 'm', judgeModel: 'j2' } }).sameConditions === false);

// 描述優化 markdown：最佳輪、逐題表
const dfake = { skill: 's', triggerModel: 'm', proposerModel: 'p', runsPerQuery: 2, holdout: 0.4, seed: 42, split: { train: [{ query: 'q1', shouldTrigger: true }], test: [{ query: 'q2', shouldTrigger: false }] }, rounds: [{ round: 0, source: 'current', description: 'd0', train: { passed: 0, total: 1, perQuery: [{ query: 'q1', shouldTrigger: true, fired: 0, n: 2, pass: false }] }, test: { passed: 1, total: 1, perQuery: [{ query: 'q2', shouldTrigger: false, fired: 0, n: 2, pass: true }] } }, { round: 1, source: 'proposed', description: 'd1', train: { passed: 1, total: 1, perQuery: [{ query: 'q1', shouldTrigger: true, fired: 2, n: 2, pass: true }] }, test: { passed: 1, total: 1, perQuery: [{ query: 'q2', shouldTrigger: false, fired: 0, n: 2, pass: true }] } }], best: { round: 1, description: 'd1', testScore: '1/1', trainScore: '1/1' }, note: 'n' };
const dmd = describeMarkdown(dfake);
t('描述優化 markdown：最佳輪與逐題', /最佳（第 1 輪/.test(dmd) && /held-out/.test(dmd) && /2\/2 ✓/.test(dmd));

// HTML 渲染器（若存在）：三種都能吐出含關鍵字的 HTML、不含外部資源
try {
  const R = await import('./render.mjs');
  const sample = { kind: 'report', name: 'fx', generatedAt: 'T', arms: ['with', 'without'], runsPlanned: 1, cases: [{ id: 'c1', type: 'trap', arms: { with: { pass: 1, total: 1, validRuns: 1, invalidRuns: 0, failures: 0, skillFired: 1, skillFiredKnown: 1 }, without: { pass: 0, total: 1, validRuns: 1, invalidRuns: 0, failures: 0, skillFired: 0, skillFiredKnown: 0 } } }], assertions: { x: { family: 'fact', text: 'X', arms: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } } } }, totals: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } }, cost: {}, flags: [], similarity: [], invalidRuns: [], harnessFailures: [], sensitivity: { delta: 1, flipsToErase: 1, flipsToReverse: 2, note: '' }, nextSteps: ['n'], conditions: { executorModel: 'm', judgeModel: 'j', isolation: [], platform: 'p', node: 'v', claudeVersion: 'c' }, lock: { ok: true, lockedAt: 'L' }, runs: [{ case: 'c1', arm: 'with', run: 'r1', ok: true, durationMs: 1, verdicts: [{ id: 'x', pass: true, evidence: 'e<b>' }], output: '<script>x</script>', artifacts: [] }] };
  const h1 = R.renderReportHtml(sample, {});
  t('render：報告 HTML 含先看這裡且已 escape', /先看這裡/.test(h1) && !/<script>x<\/script>/.test(h1) && /&lt;script&gt;/.test(h1));
  t('render：報告 HTML 無外部資源', !/(src|href)=["']https?:\/\//.test(h1) && !/@import\s+url\(/.test(h1));
  const h2 = R.renderMatrixHtml(mx, {}); t('render：矩陣 HTML', /m1-default/.test(h2));
  const h3 = R.renderDescribeHtml(dfake, {}); t('render：描述優化 HTML', /held-out|最佳/.test(h3));
} catch (e) { t('render.mjs 可載入（' + (e?.message || e).toString().slice(0, 80) + '）', false); }

fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(mdir, { recursive: true, force: true });
console.log(`\n${n - bad}/${n} 通過`);
process.exit(bad ? 1 : 0);
