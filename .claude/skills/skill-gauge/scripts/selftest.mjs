#!/usr/bin/env node
// 引擎自我測試（不呼叫模型、幾秒跑完）：純函式與報告數學。 node scripts/selftest.mjs
process.env.GAUGE_NO_MAIN = '1';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { ancestorsWithClaude, bigramDice, compareReports, extractJSONArray, parseArgs, summarizeTrigger, splitTrainTest, getDescription, setDescription, extractPressure, buildMatrix, matrixMarkdown, slugify, lastTwoComparable, pressureHeldText, describeMarkdown, buildPreview, extractSayNotSay, plainSummary, assertionLabel, summaryMarkdown, deriveCostMetrics, decisionFirstLines, decisionFirstMarkdown, sumComplete, buildReport, usdDigits, fmtUsd, reportMarkdown, validCostUsd, classifyScenario, benefitKind, costFlowVerdict, verdictContractError, usdFmt, scenarioVerdict } = await import('./gauge.mjs');
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

// 缺值誠實：sumComplete 已知答案——全部有值才回真的加總；缺一個就整個回 null（不冒充較小的完整數字）；空集合也回 null（不算 0）
{
  const s1 = sumComplete([1, 2, 3]);
  t('sumComplete：全部有值→正常加總，recorded=total=3', s1.value === 6 && s1.recorded === 3 && s1.total === 3 && s1.complete === true);
  const s2 = sumComplete([1, null, 3]);
  t('sumComplete：部分缺值（1/3 缺）→ value=null，recorded/total 誠實回報 2/3', s2.value === null && s2.recorded === 2 && s2.total === 3 && s2.complete === false);
  const s3 = sumComplete([]);
  t('sumComplete：空集合→ value=null（不是 0），total=0', s3.value === null && s3.recorded === 0 && s3.total === 0 && s3.complete === false);
  const s4 = sumComplete([null, null]);
  t('sumComplete：全缺值→ value=null，recorded=0/total=2', s4.value === null && s4.recorded === 0 && s4.total === 2);
}

// 成本派生欄：已知答案（陽性：3 元／3 個成功 run／1 個有效但未成功／6 個過的格 → 逐項算對；
// 陰性：成功數 0 不准除以 0，回 null，一次到位率仍能算；分母（成功＋有效但未成功）也是 0 時一次到位率回 null；
// totalCostUsd 為 null（成本記錄不完整）時兩個 USD 派生欄都回 null，但一次到位率不受影響——它只跟 gate 分類有關，跟成本完整度無關）
const dmPos = deriveCostMetrics({ totalCostUsd: 3, successRuns: 3, notFirstPassRuns: 1, passedChecks: 6 });
t('成本派生（陽性）：每次全對的成本 3/3=1、每過格成本 3/6=0.5、一次到位率 3/(3+1)=0.75', dmPos.perSuccessCostUsd === 1 && dmPos.perPassedCheckCostUsd === 0.5 && Math.abs(dmPos.firstPassRate - 0.75) < 1e-9);
const dmZeroSuccess = deriveCostMetrics({ totalCostUsd: 5, successRuns: 0, notFirstPassRuns: 2, passedChecks: 0 });
t('成本派生（陰性）：成功數與通過格數都 0 時，每次全對的成本／每過格成本回 null（不除以 0）；一次到位率 0/(0+2)=0（分母仍在）', dmZeroSuccess.perSuccessCostUsd === null && dmZeroSuccess.perPassedCheckCostUsd === null && dmZeroSuccess.firstPassRate === 0);
const dmZeroDenom = deriveCostMetrics({ totalCostUsd: 5, successRuns: 0, notFirstPassRuns: 0, passedChecks: 0 });
t('成本派生（陰性）：成功＋有效但未成功也是 0 時，一次到位率同樣回 null（不除以 0）', dmZeroDenom.firstPassRate === null);
const dmNullCost = deriveCostMetrics({ totalCostUsd: null, successRuns: 3, notFirstPassRuns: 1, passedChecks: 6 });
t('成本派生（缺值）：totalCostUsd=null 時兩個 USD 派生欄回 null，一次到位率不受影響仍為 0.75', dmNullCost.perSuccessCostUsd === null && dmNullCost.perPassedCheckCostUsd === null && Math.abs(dmNullCost.firstPassRate - 0.75) < 1e-9);

// 美元位數自適應：目前位數下兩個不同值會顯示一樣（含都顯示成 0）就加位數，直到能分辨或到位數上限；只有一個值或都缺值維持預設 3 位
t('usdDigits：3 位就分得出來，維持 3 位', usdDigits([0.02, 0.01]) === 3);
t('usdDigits：3 位下顯示一樣（0.002 vs 0.002）→ 加到 4 位分得出來', usdDigits([0.0021, 0.0024]) === 4 && fmtUsd(0.0021, 4) === '$0.0021' && fmtUsd(0.0024, 4) === '$0.0024');
t('usdDigits：3 位下都顯示成 0.000（0.0001 vs 0.0002）→ 加到 4 位', usdDigits([0.0001, 0.0002]) === 4);
t('usdDigits：只有一個值就維持預設 3 位（沒有東西要分辨）', usdDigits([0.02]) === 3);
t('fmtUsd：null 回 null', fmtUsd(null, 3) === null);

// 決策優先摘要 v2（場景全對制）：主敘事是【成功率】，格數降為第二層；固定行＝結論／成功率／情境地圖／效果／穩度／成本／邊界＋三路線建議。
// 成本行用「場景全對（AI 評分）」，不出現「機械層全過」「判定通過」；一次到位仍是 proxy：x/y 格式＋「非人機來回實測」字樣。
{
  const dfRep = { name: 'fx-cost', arms: ['with', 'without'], invalidRuns: [], harnessFailures: [], discardedRunIds: [], runsPlanned: 10,
    cases: [
      { id: 'c-high', arms: { with: { scenario: { success: 9, notFirstPass: 1, indeterminate: 0, discarded: 0 } }, without: { scenario: { success: 6, notFirstPass: 4, indeterminate: 0, discarded: 0 } } } },
    ],
    totals: { with: { pass: 9, total: 10 }, without: { pass: 6, total: 10 } }, sensitivity: { delta: 3, sameDenominator: true, flipsToReverse: 4 },
    cost: { with: { runs: 10, costComplete: true, perSuccessCostUsd: 0.02, successRuns: 9, notFirstPassRuns: 1 }, without: { runs: 10, costComplete: true, perSuccessCostUsd: 0.01, successRuns: 6, notFirstPassRuns: 4 } },
    summary: { verdict: 'better', needFix: '有幫助，可以留著：多 3 格', winsPlain: ['某檢查項'] } };
  const dfl = decisionFirstLines(dfRep);
  const head = (tag) => dfl.find((l) => l.startsWith(tag)) || '';
  t('決策優先 v2：固定七行齊全（結論／成功率／情境地圖／效果／穩度／成本／邊界），順序寫死', dfl.slice(0, 7).map((l) => l.slice(0, l.indexOf('】') + 1)).join('') === '【結論】【成功率】【情境地圖】【效果】【穩度】【成本】【邊界】');
  t('決策優先 v2：【成功率】是主敘事——場景全對（AI 評分）＋兩組原始計數與百分比', /^【成功率】場景全對（AI 評分）：帶 9\/10（90%） vs 不帶 6\/10（60%）——分母是有效 run/.test(dfl[1]));
  t('決策優先 v2：【情境地圖】只有一題時明說畫不出高低情境，並附那題的全對率', /^【情境地圖】只有一題有資料：c-high（帶 9\/10，90%；不帶 6\/10，60%）/.test(dfl[2]));
  t('決策優先：效果句用「N 格檢查結果」與「多過的檢查項包括」（不寫「N 項檢查」「集中在」）', /10 格檢查結果：帶 9 格（90%）vs 不帶 6 格（60%）；多過的檢查項包括 某檢查項/.test(head('【效果】')) && !/項檢查|集中在/.test(head('【效果】')));
  t('決策優先：成本句用「場景全對（AI 評分）」，不出現「機械層全過」「判定通過」', /場景全對（AI 評分）/.test(head('【成本】')) && !/機械層全過|判定通過/.test(head('【成本】')));
  t('決策優先：成本句帶原始金額', /帶 \$0\.020 vs 不帶 \$0\.010/.test(head('【成本】')));
  t('決策優先：一次到位是 proxy：x/y 格式＋「非人機來回實測」字樣，且帶原始計數', /一次到位（proxy，非人機來回實測）帶 90%（proxy：9\/10） vs 不帶 60%（proxy：6\/10）/.test(head('【成本】')));
  t('決策優先：成本行印出決策矩陣門檻字樣（≥20%、標明是經驗值）', /門檻：每次全對的成本差 ≥20% 視為顯著（經驗值，未校準）/.test(head('【成本】')));
  t('決策優先：穩度顯示原始 k＋單臂格數，不做 k/N 比值，也沒有三級分級字樣', /要 4 個判定同時翻掉，結論才會反過來（單臂共 10 格）$/.test(head('【穩度】')) && !/k\/N|邊緣/.test(head('【穩度】')));
  t('決策優先：【邊界】加單 skill 隔離句', /單 skill 隔離，不反映多 skill 併存時的觸發表現/.test(head('【邊界】')));
  t('決策優先：三路線建議段（改 skill／改用法／發掘）各出一行', dfl.some((l) => l.startsWith('【建議·改 skill】')) && dfl.some((l) => l.startsWith('【建議·改用法】')) && dfl.some((l) => l.startsWith('【建議·發掘】')));
  t('決策優先：沒有量測層問題時不出「改題目」那一行', !dfl.some((l) => l.startsWith('【建議·改題目】')));
  const dfMd = decisionFirstMarkdown(dfRep);
  t('決策優先 markdown：含決策摘要標題與結論行', dfMd.some((l) => l.includes('決策摘要')) && dfMd.some((l) => l.includes('【結論】')));
}

// 詞彙（正式裁定 v1.3-1）：沒有全對 run 時成本格寫「無全對 run」，不寫「無成功 run」
{
  const noFull = decisionFirstLines({ name: 'fx-nofull', arms: ['with', 'without'], invalidRuns: [], harnessFailures: [], discardedRunIds: [], cases: [{ id: 'c1' }], runsPlanned: 3,
    totals: { with: { pass: 3, total: 9 }, without: { pass: 3, total: 9 } }, sensitivity: { delta: 0, sameDenominator: true, flipsToReverse: 1 },
    cost: { with: { runs: 3, costComplete: true, perSuccessCostUsd: null, successRuns: 0, notFirstPassRuns: 3 }, without: { runs: 3, costComplete: true, perSuccessCostUsd: 0.01, successRuns: 1, notFirstPassRuns: 2 } },
    summary: { verdict: 'same', needFix: 'x' } });
  const costLine = noFull.find((l) => l.startsWith('【成本】'));
  t('詞彙：沒有全對 run 時寫「無全對 run」，不寫「無成功 run」', /帶 無全對 run vs 不帶 \$0\.010/.test(costLine) && !/無成功 run/.test(costLine));
  t('詞彙：全對率 0/3＝0%，不因為沒有全對 run 就變成無資料', /【成功率】場景全對（AI 評分）：帶 0\/3（0%） vs 不帶 1\/3（33%）/.test(noFull[1]));
}

// B6：wins 為空時不得輸出「多過的檢查項包括 沒有特別集中的類別」這種自相矛盾句
{
  const noWins = decisionFirstLines({ name: 'fx-nowin', arms: ['with', 'without'], invalidRuns: [], harnessFailures: [], discardedRunIds: [], cases: [{ id: 'c1' }], runsPlanned: 10,
    totals: { with: { pass: 8, total: 10 }, without: { pass: 8, total: 10 } }, sensitivity: { delta: 0, sameDenominator: true, flipsToReverse: 1 },
    cost: { with: { runs: 10, successRuns: 8, notFirstPassRuns: 2 }, without: { runs: 10, successRuns: 8, notFirstPassRuns: 2 } }, summary: { verdict: 'same', needFix: 'x', winsPlain: [] } });
  const eff = noWins.find((l) => l.startsWith('【效果】'));
  t('效果句：沒有多過的檢查項時寫「沒有多過的檢查項」，不寫「包括 沒有特別集中的類別」', /；沒有多過的檢查項$/.test(eff) && !/沒有特別集中的類別/.test(eff));
}

// 穩度：k≤2 加既定薄弱警語；k=3/5/6 都只顯示 k＋單臂格數（不做比值、不分級）；同格 run 高度相似時警語升級（不得稱穩）
{
  const stabBase = { name: 'fx-stab', arms: ['with', 'without'], invalidRuns: [], harnessFailures: [], discardedRunIds: [], cases: [{ id: 'c1' }], runsPlanned: 10, summary: { verdict: 'better', needFix: 'x' } };
  const stabCost = { with: { runs: 10, successRuns: 8, notFirstPassRuns: 2 }, without: { runs: 10, successRuns: 6, notFirstPassRuns: 4 } };
  const mkStab = (k, extraFlags = []) => decisionFirstLines({ ...stabBase, totals: { with: { pass: 8, total: 10 }, without: { pass: 8 - k, total: 10 } }, sensitivity: { delta: k, sameDenominator: true, flipsToReverse: k }, cost: stabCost, flags: extraFlags }).find((l) => l.startsWith('【穩度】'));
  t('穩度：k=2 加「只當線索，不當定論」警語，不出現「邊緣」「穩」', /要 2 個判定同時翻掉，結論才會反過來（單臂共 10 格）——只當線索，不當定論$/.test(mkStab(2)));
  t('穩度：k=3（舊制「邊緣」）只顯示 k＋單臂格數，沒有警語也沒有分級字樣', /要 3 個判定同時翻掉，結論才會反過來（單臂共 10 格）$/.test(mkStab(3)));
  t('穩度：k=6（舊制「穩」）也只顯示 k＋單臂格數，不出現「穩」字樣（【穩度】標籤本身的「穩」不算）', /（單臂共 10 格）$/.test(mkStab(6)) && !/穩/.test(mkStab(6).replace(/^【穩度】/, '')));
  t('穩度：k 可以大於單臂格數（完美分離）也照樣顯示 k，不做比值運算', (() => { const line = decisionFirstLines({ ...stabBase, totals: { with: { pass: 10, total: 10 }, without: { pass: 0, total: 10 } }, sensitivity: { delta: 10, sameDenominator: true, flipsToReverse: 11 }, cost: stabCost, flags: [] }).find((l) => l.startsWith('【穩度】')); return /要 11 個判定同時翻掉/.test(line) && /（單臂共 10 格）/.test(line); })());
  t('穩度：同格 run 高度相似時警語升級（即使 k>2，不得稱穩）', /同格 run 高度相似，有效樣本比 k 顯示的小/.test(mkStab(4, ['同格 run 高度相似：c1/with 平均相似度 0.90——有效樣本比 2 小'])));
  t('穩度：k≤2 且同格相似同時成立，兩個警語都要出現', (() => { const line = mkStab(1, ['同格 run 高度相似：x']); return /只當線索，不當定論/.test(line) && /同格 run 高度相似/.test(line); })());
}

// 決策矩陣門檻（正式裁定 v1.3-2）：rel＝(b−a)／max(a,b)，≥20%（含邊界）＝顯著。
// 下面這張 oracle 表是先按裁定用手算出來的（rel 欄），再拿去對實作——不是把實作的輸出抄一遍。
// a＝帶 skill 每次全對的成本、b＝不帶。base＝max(a,b)（兩者皆 0 時取 1）。
//   a=0.006 b=0.010 → base .010、b−a=.004 → rel=+0.40 → cheaper
//   a=0.008 b=0.010 → base .010、b−a=.002 → rel=+0.20 → cheaper（含邊界）
//   a=0.800 b=1.000 → base 1.00、b−a=.200 → rel=+0.20 → cheaper（浮點下原值 0.19999…，裁定是名目 20%，所以必須算顯著）
//   a=0.0081 b=0.010 → rel=+0.19 → similar
//   a=0.009 b=0.010 → rel=+0.10 → similar
//   a=0.010 b=0.008 → rel=−0.20 → pricier（含邊界）
//   a=1.000 b=0.800 → rel=−0.20 → pricier
//   a=0.010 b=0.0081 → rel=−0.19 → similar
//   a=0.020 b=0.010 → base .020、b−a=−.010 → rel=−0.50 → pricier
//   a=0 b=0.010 → rel=+1.00 → cheaper
//   a=0.010 b=0 → rel=−1.00 → pricier
//   a=0 b=0 → 兩者皆 0，視為相當 → similar
//   任一缺值／負值 → unknown（不進 rel）
{
  const ORACLE = [
    [0.006, 0.01, 'cheaper'], [0.008, 0.01, 'cheaper'], [0.8, 1, 'cheaper'], [0.0081, 0.01, 'similar'], [0.009, 0.01, 'similar'],
    [0.01, 0.008, 'pricier'], [1, 0.8, 'pricier'], [0.01, 0.0081, 'similar'], [0.02, 0.01, 'pricier'],
    [0, 0.01, 'cheaper'], [0.01, 0, 'pricier'], [0, 0, 'similar'],
    [null, 0.01, 'unknown'], [0.01, null, 'unknown'], [-0.01, 0.01, 'unknown'], [0.01, -0.01, 'unknown'],
  ];
  const LABEL = { cheaper: '留用（效率工具）', pricier: '建議退役（成本負擔）', similar: '建議退役', unknown: '效率未判' };
  const sameBase = { name: 'fx-same', arms: ['with', 'without'], invalidRuns: [], harnessFailures: [], discardedRunIds: [], cases: [{ id: 'c1' }, { id: 'c2' }], runsPlanned: 5, totals: { with: { pass: 8, total: 10 }, without: { pass: 8, total: 10 } }, sensitivity: { delta: 0, sameDenominator: true, flipsToReverse: 1 }, summary: { verdict: 'same', needFix: '兩組差不多' } };
  let oracleBad = 0;
  for (const [a, b, want] of ORACLE) {
    const line = decisionFirstLines({ ...sameBase, cost: { with: { runs: 10, costComplete: true, perSuccessCostUsd: a, successRuns: 8, notFirstPassRuns: 2 }, without: { runs: 10, costComplete: true, perSuccessCostUsd: b, successRuns: 8, notFirstPassRuns: 2 } } })[0];
    const ok = line.includes(LABEL[want]) && (want !== 'unknown' || !/退役/.test(line)) && (want !== 'cheaper' || !/退役/.test(line));
    if (!ok) { oracleBad++; console.log('   oracle miss:', a, b, '應為', want, '得到', line.slice(0, 60)); }
  }
  t(`決策矩陣門檻 oracle 表（${ORACLE.length} 列手算預期值）逐列符合`, oracleBad === 0);
  const unknownCost = decisionFirstLines({ ...sameBase, cost: { with: { runs: 10, costComplete: false, costRecorded: 7, costTotal: 10, perSuccessCostUsd: null, successRuns: 8, notFirstPassRuns: 2 }, without: { runs: 10, costComplete: true, perSuccessCostUsd: 0.01, successRuns: 8, notFirstPassRuns: 2 } } });
  t('決策矩陣：成本記錄不完整→「效率未判」，整份輸出禁止出現「退役」字樣', /效率未判/.test(unknownCost[0]) && !/退役/.test(unknownCost.join('')));
}

// 資料充分性 guard 分兩層（正式裁定 v1.3-5）：
//   第一層 blocking＝兩臂根本不是同一個實驗（前置作廢、題×次不對齊、實際模型不同、有格子沒判定）→ 第一頁只出資料不足；
//   第二層 comparability＝計分母體不一致（通常是有 run 沒過前置檢查）→ 只有【效果】【穩度】不判，【成功率】【成本】照出。
//   gate 明確 false 的 run 是「有效但未成功」，不是作廢，**不餵 guard**；舊的 invalidRuns 欄位同樣不餵。
{
  const guardBase = { name: 'fx-guard', arms: ['with', 'without'], cases: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], runsPlanned: 3, sensitivity: { delta: 0, sameDenominator: true, flipsToReverse: 1 }, summary: { verdict: 'same', needFix: 'x' } };
  const guardDisc = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 8, total: 9 } }, invalidRuns: [], harnessFailures: ['c1/with/r1', 'c1/without/r1'], discardedRunIds: ['c1/with/r1', 'c1/without/r1'], cost: { with: { runs: 9 }, without: { runs: 9 } } });
  t('guard（第一層）：兩組各有一次前置作廢、總格數剛好相同，仍判資料不足', /資料不足/.test(guardDisc[0]) && /執行／評分失敗/.test(guardDisc[0]) && !/需要改進|可留用|建議退役|效率工具/.test(guardDisc[0]) && /【穩度】資料不足/.test(guardDisc[4]) && /【成本】資料不足/.test(guardDisc[5]));
  const guardInvalidOnly = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 7, total: 9 } }, invalidRuns: ['c1/with/r1', 'c1/without/r1'], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9, successRuns: 8, notFirstPassRuns: 1 }, without: { runs: 9, successRuns: 7, notFirstPassRuns: 2 } } });
  t('guard：舊的 invalidRuns（gate 明確 false）不餵 guard——有它照樣下結論，不變成資料不足', !/資料不足/.test(guardInvalidOnly[0]));
  const guardRuns = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 7, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9 }, without: { runs: 6 } } });
  t('guard（第一層）：實跑次數與計畫不同（一臂少跑）判資料不足', /資料不足/.test(guardRuns[0]) && /實跑次數與計畫不同/.test(guardRuns[0]));
  const guardKeys = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 7, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9 }, without: { runs: 9 } }, runKeys: { c1: { with: ['r1', 'r2', 'r3'], without: ['r1', 'r2', 'r3'] }, c2: { with: ['r1', 'r2', 'r3', 'r4'], without: ['r1', 'r2'] }, c3: { with: ['r1', 'r2'], without: ['r1', 'r2', 'r3', 'r4'] } } });
  t('guard（第一層）：兩組總次數相同但逐題分布不同（題×次不對齊）判資料不足', /資料不足/.test(guardKeys[0]) && /題×次不對齊/.test(guardKeys[0]));
  const guardModels = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 7, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9, models: ['m1'] }, without: { runs: 9, models: ['m2'] } } });
  t('guard（第一層）：兩組實際跑的模型不同判資料不足', /資料不足/.test(guardModels[0]) && /實際跑的模型不同/.test(guardModels[0]));
  const guardNull = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 7, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9 }, without: { runs: 9 } }, assertions: { 'fact-a': { family: 'fact', arms: { with: { pass: 3, total: 3, eligible: 3 }, without: { pass: 2, total: 2, eligible: 3 } } } } });
  t('guard（第一層）：有格子沒拿到判定（評分回 null）判資料不足', /資料不足/.test(guardNull[0]) && /沒拿到判定/.test(guardNull[0]));
  const guardCross = decisionFirstLines({ ...guardBase, totals: { with: { pass: 6, total: 9 }, without: { pass: 6, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9, successRuns: 6, notFirstPassRuns: 3 }, without: { runs: 9, successRuns: 6, notFirstPassRuns: 3 } }, assertions: { 'fact-a': { family: 'fact', arms: { with: { pass: 3, total: 3, eligible: 3 }, without: { pass: 0, total: 0 } } }, 'fact-b': { family: 'fact', arms: { with: { pass: 0, total: 0 } , without: { pass: 3, total: 3, eligible: 3 } } } } });
  t('guard（第二層）：兩臂各自漏掉不同檢查項、總格數仍相同→逐條母體不同，效果與穩度不判（結論改由全對率驅動，照樣出）', /計分格那一層不可比/.test(guardCross[0]) && /逐條檢查項的判定母體不同/.test(guardCross.find((l) => l.startsWith('【效果】'))) && /【穩度】兩組計分母體不一致/.test(guardCross.find((l) => l.startsWith('【穩度】'))) && !/資料不足/.test(guardCross[0]));
  const guardPop = decisionFirstLines({ ...guardBase, totals: { with: { pass: 5, total: 8 }, without: { pass: 5, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9, successRuns: 5, notFirstPassRuns: 4 }, without: { runs: 9, successRuns: 6, notFirstPassRuns: 3 } } });
  t('guard（第二層）：計分母體格數不同→效果不判，但【成功率】【成本】照出（不是整頁資料不足）；結論由全對率驅動＝退役方向', /退役方向/.test(guardPop[0]) && /計分格那一層不可比/.test(guardPop[0]) && /不比格數/.test(guardPop.find((l) => l.startsWith('【效果】'))) && !/^【成功率】資料不足/.test(guardPop[1]) && /帶 5\/9（56%） vs 不帶 6\/9（67%）/.test(guardPop[1]));
  const guardOk = decisionFirstLines({ ...guardBase, totals: { with: { pass: 8, total: 9 }, without: { pass: 7, total: 9 } }, invalidRuns: [], harnessFailures: [], discardedRunIds: [], cost: { with: { runs: 9, successRuns: 8, notFirstPassRuns: 1 }, without: { runs: 9, successRuns: 7, notFirstPassRuns: 2 } } });
  t('guard：資料齊全時不觸發（對照組，確保 guard 沒有過度觸發）', !/資料不足|不可比/.test(guardOk[0]) && /可留用/.test(guardOk[0]));
}

// 第三臂（一句提醒等）逐臂獨立驗、獨立標註，不影響被比較的兩臂（正式裁定 v1.3-4）
{
  const threeBase = { name: 'fx-three', arms: ['with', 'without', 'reminder'], cases: [{ id: 'c1' }, { id: 'c2' }], runsPlanned: 3, invalidRuns: [], harnessFailures: [], discardedRunIds: [],
    totals: { with: { pass: 5, total: 6 }, without: { pass: 3, total: 6 } }, sensitivity: { delta: 2, sameDenominator: true, flipsToReverse: 3 }, summary: { verdict: 'better', needFix: 'x' } };
  const shortThird = decisionFirstLines({ ...threeBase, cost: { with: { runs: 6, successRuns: 5, notFirstPassRuns: 1 }, without: { runs: 6, successRuns: 3, notFirstPassRuns: 3 }, reminder: { runs: 2, successRuns: 1, notFirstPassRuns: 1 } } });
  t('三臂：第三臂少跑不擋主比較（主結論照出）', !/資料不足/.test(shortThird[0]) && /可留用/.test(shortThird[0]));
  t('三臂：第三臂少跑要獨立標註「本臂資料不足」', /【第三組】reminder：本臂資料不足（實跑 2 次、計畫 6 次），不進主比較/.test(shortThird.find((l) => l.startsWith('【第三組】'))));
  const badThird = decisionFirstLines({ ...threeBase, harnessFailures: ['c1/reminder/r1'], discardedRunIds: ['c1/reminder/r1'], cost: { with: { runs: 6, successRuns: 5, notFirstPassRuns: 1 }, without: { runs: 6, successRuns: 3, notFirstPassRuns: 3 }, reminder: { runs: 6, successRuns: 3, notFirstPassRuns: 3 } } });
  t('三臂：第三臂有前置作廢也不擋主比較，只標在第三組那一行', !/資料不足/.test(badThird[0]) && /【第三組】reminder：本臂資料不足（有 1 次前置作廢）/.test(badThird.find((l) => l.startsWith('【第三組】'))));
  const okThird = decisionFirstLines({ ...threeBase, cost: { with: { runs: 6, successRuns: 5, notFirstPassRuns: 1 }, without: { runs: 6, successRuns: 3, notFirstPassRuns: 3 }, reminder: { runs: 6, successRuns: 4, notFirstPassRuns: 2 } } });
  t('三臂：第三臂資料齊全時報它自己的全對率', /【第三組】reminder：場景全對 4\/6（67%）/.test(okThird.find((l) => l.startsWith('【第三組】'))));
}

// STOP：不得寫「只跑了基準組」，改「未完成同題組同次數的兩臂成本比較」；「成本臂」字樣改「完整兩臂成本比較」；
// 引擎停案後帶 skill 那組仍可能有安全探針等部分資料，這種情況要點出「不是完整比較」；停案屬量測層問題→出「改題目」建議
{
  const dfStop = decisionFirstLines({ name: 'fx-stop', arms: ['with', 'without'], baseline: { arm: 'without', verdict: 'STOP', note: '基準組每次都過。能力上不需要；效率價值未判——要判，加跑完整兩臂成本比較。' }, summary: { helped: '基準組每次都做對。' } });
  const pick = (tag) => dfStop.find((l) => l.startsWith(tag)) || '';
  t('決策優先：停案時結論沿用停案措辭、成本行標「效率價值未判」', pick('【結論】').includes('效率價值未判') && pick('【成本】').includes('效率價值未判'));
  t('決策優先：停案時七行齊全（含成功率與情境地圖），且都改「未完成同題組同次數的兩臂…」措辭', ['【結論】', '【成功率】', '【情境地圖】', '【效果】', '【穩度】', '【成本】', '【邊界】'].every((tag) => pick(tag)) && /未完成同題組同次數的兩臂比較/.test(pick('【成功率】')) && /未完成同題組同次數的兩臂比較/.test(pick('【情境地圖】')));
  t('決策優先：停案時不寫「只跑了基準組」「成本臂」', !/只跑了基準組/.test(dfStop.join('')) && !/成本臂/.test(dfStop.join('')));
  t('決策優先：停案＝量測層問題→出「改題目」建議，三路線退誠實句', /【建議·改題目】/.test(dfStop.join('\n')) && /【建議·改 skill】未完成同題組同次數的兩臂比較/.test(dfStop.find((l) => l.startsWith('【建議·改 skill】'))));
  const dfStopPartial = decisionFirstLines({ name: 'fx-stop2', arms: ['with', 'without'], baseline: { arm: 'without', verdict: 'STOP', note: '基準組每次都過。' }, summary: { helped: '基準組每次都做對。' }, cost: { with: { runs: 3 } } });
  t('決策優先：停案後帶 skill 那組仍有部分資料（安全探針）時，穩度行要點出不是完整比較', /帶 skill 那組另有 3 次部分資料/.test(dfStopPartial.find((l) => l.startsWith('【穩度】'))) && /不是完整的兩臂比較/.test(dfStopPartial.find((l) => l.startsWith('【穩度】'))));
}

// 零鑑別（量測層問題）→ 建議段要出「改題目」那一行
{
  const zeroDisc = decisionFirstLines({ name: 'fx-zero', arms: ['with', 'without'], invalidRuns: [], harnessFailures: [], discardedRunIds: [], cases: [{ id: 'c1' }], runsPlanned: 3,
    totals: { with: { pass: 3, total: 3 }, without: { pass: 3, total: 3 } }, sensitivity: { delta: 0, sameDenominator: true, flipsToReverse: 1 },
    cost: { with: { runs: 3 }, without: { runs: 3 } }, flags: ['零鑑別：fact-a 兩組全過——測不出差別'], summary: { verdict: 'same', needFix: 'x' } });
  t('建議段：有零鑑別旗標時出「改題目」那一行（量測層問題不跟三路線混）', /【建議·改題目】量測層的問題要先修：1 條檢查兩組全過（零鑑別）/.test(zeroDisc.find((l) => l.startsWith('【建議·改題目】'))));
}

// 觸發彙整：逐 query 多數決；該觸發有觸發＝過、不該觸發沒觸發＝過
const rows = [
  { kind: 'should', query: 'q1', run: 1, fired: true, ok: true }, { kind: 'should', query: 'q1', run: 2, fired: false, ok: true }, { kind: 'should', query: 'q1', run: 3, fired: true, ok: true },
  { kind: 'should', query: 'q2', run: 1, fired: false, ok: true }, { kind: 'should', query: 'q2', run: 2, fired: false, ok: true }, { kind: 'should', query: 'q2', run: 3, fired: true, ok: true },
  { kind: 'shouldNot', query: 'n1', run: 1, fired: false, ok: true }, { kind: 'shouldNot', query: 'n1', run: 2, fired: true, ok: true }, { kind: 'shouldNot', query: 'n1', run: 3, fired: false, ok: true },
  { kind: 'shouldNot', query: 'n2', run: 1, fired: true, ok: false },
];
const ts = summarizeTrigger(rows);
t('觸發彙整：失敗 run 不計', ts.shouldNot.n === 3 && ts.should.n === 6);
t('觸發彙整：逐 query 多數決（q1 過、q2 不過、n1 過）；有失敗 run 的 n2 保守算不過且標 incomplete', ts.perQuery.find((q) => q.query === 'q1').pass && !ts.perQuery.find((q) => q.query === 'q2').pass && ts.perQuery.find((q) => q.query === 'n1').pass && ts.perQuery.find((q) => q.query === 'n2').incomplete === true && !ts.perQuery.find((q) => q.query === 'n2').pass && ts.queriesPassed === 2 && ts.queriesTotal === 4 && ts.queriesIncomplete === 1);
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
t('壓力 inconclusive → 守住條 pass:null（只有這條不算分，同 run 其他照算）', e3.arr.find((v) => v.id === 'held:p1').pass === null && e3.pressure.verdict === 'inconclusive');
const e4 = extractPressure([{ id: 'x', pass: true }, { id: '__pressure__', verdict: 'overapplied' }], kase);
t('壓力極性：comply 題回 overapplied → 歸 refused（沒違反但沒交付）', e4.pressure.verdict === 'refused' && e4.pressure.rawVerdict === 'overapplied' && /極性/.test(e4.pressure.polarityNote) && e4.arr.find((v) => v.id === 'held:p1').pass === false);
const kaseEx = { ...kase, expectedBehavior: 'exempt' };
t('壓力極性：exempt 題回 violated → inconclusive', extractPressure([{ id: '__pressure__', verdict: 'violated' }], kaseEx).pressure.verdict === 'inconclusive');
t('壓力：refused 是合法 verdict', extractPressure([{ id: '__pressure__', verdict: 'refused' }], kase).pressure.verdict === 'refused');
t('壓力：說詞逐字檢查（在產出裡＝true、不在＝false）', JSON.stringify(extractPressure([{ id: '__pressure__', verdict: 'violated', rationalizations: ['先寫上去', '這句不在'] }], kase, '老闆催，我就先寫上去了').pressure.rationalizationsVerbatim) === '[true,false]');
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
const T2 = { with: { pass: 1, total: 1 }, without: { pass: 1, total: 1 } };
const hist = [
  { kind: 'report', outDir: path.join(mdir, 'm1-default'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1', totals: T2, baselineVerdict: 'CONTINUE' },
  { kind: 'report', outDir: path.join(mdir, 'm2-low'), executorModel: 'a', effort: 'low', judgeModel: 'j', lockedAt: 'L1', totals: T2, baselineVerdict: 'CONTINUE' },
  { kind: 'baseline', outDir: path.join(mdir, 'm1-default'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1', totals: { without: { pass: 1, total: 1 } }, baselineVerdict: 'CONTINUE' },
  { kind: 'report', outDir: path.join(mdir, 'm1-again'), executorModel: 'a', effort: null, judgeModel: 'j2', lockedAt: 'L1', totals: T2, baselineVerdict: 'CONTINUE' },
  { kind: 'matrix-cell', outDir: path.join(mdir, 'm1-again'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1', totals: { without: { pass: 1, total: 1 } }, baselineVerdict: 'STOP' },
  { kind: 'report', outDir: path.join(mdir, 'm1-again'), executorModel: 'a', effort: null, judgeModel: 'j', lockedAt: 'L1', totals: T2, baselineVerdict: 'CONTINUE' },
];
const pair = lastTwoComparable(hist);
t('歷史配對：跳過 effort／評分模型不同、baseline、停案格、同目錄，取最近兩次同條件', pair && pair[0] === hist[0] && pair[1] === hist[5]);
t('compare：沒有共同檢查項＝not-comparable', compareReports({ arms: ['with', 'without'], assertions: {}, totals: {}, conditions: {}, lock: {} }, mk([1, 1, 1])).overall === 'not-comparable');
t('歷史配對：找不到回 null', lastTwoComparable([hist[0], hist[1]]) === null);
t('compare：評分模型不同＝條件不同', compareReports({ ...mk([3, 1, 2]), conditions: { executorModel: 'm', judgeModel: 'j1' } }, { ...mk([3, 1, 2]), conditions: { executorModel: 'm', judgeModel: 'j2' } }).sameConditions === false);

// 描述優化 markdown：最佳輪、逐題表
const dfake = { skill: 's', triggerModel: 'm', proposerModel: 'p', runsPerQuery: 2, holdout: 0.4, seed: 42, split: { train: [{ query: 'q1', shouldTrigger: true }], test: [{ query: 'q2', shouldTrigger: false }] }, rounds: [{ round: 0, source: 'current', description: 'd0', train: { passed: 0, total: 1, perQuery: [{ query: 'q1', shouldTrigger: true, fired: 0, n: 2, pass: false }] }, test: { passed: 1, total: 1, perQuery: [{ query: 'q2', shouldTrigger: false, fired: 0, n: 2, pass: true }] } }, { round: 1, source: 'proposed', description: 'd1', train: { passed: 1, total: 1, perQuery: [{ query: 'q1', shouldTrigger: true, fired: 2, n: 2, pass: true }] }, test: { passed: 1, total: 1, perQuery: [{ query: 'q2', shouldTrigger: false, fired: 0, n: 2, pass: true }] } }], best: { round: 1, description: 'd1', testScore: '1/1', trainScore: '1/1' }, note: 'n' };
const dmd = describeMarkdown(dfake);
t('描述優化 markdown：最佳輪與逐題', /最佳（第 1 輪/.test(dmd) && /held-out/.test(dmd) && /2\/2 ✓/.test(dmd));

// 核可頁：能說／不能說擷取（標題同時含兩邊關鍵字＝整段給 say，notSay 留 null；獨立標題各自擷取）
t('能說／不能說：合併標題整段當 combined、標題照原文，say／notSay 留空', (() => { const r = extractSayNotSay('## 能說／不能說（先寫死）\n- 能說 A\n- 不能說 B\n\n## 執行紀律\n其他'); return /能說 A/.test(r.combined) && /不能說 B/.test(r.combined) && r.say === null && r.notSay === null && /能說／不能說/.test(r.combinedHeading); })());
t('能說／不能說：英文 not permitted claims 歸不能說、what we can\'t say 也認得', (() => { const r = extractSayNotSay('## Permitted claims\nP\n\n## Not permitted claims\nNP\n'); const r2 = extractSayNotSay('## What we can say\nA\n\n## What we can\'t say\nB\n'); return r.say.trim() === 'P' && r.notSay.trim() === 'NP' && r2.say.trim() === 'A' && r2.notSay.trim() === 'B'; })());
t('能說／不能說：分開標題各自擷取，內文到下一個同層標題為止', (() => { const r = extractSayNotSay('## 能說\n段落一\n\n## 不能說\n段落二\n\n## 其他\n段落三'); return r.say.trim() === '段落一' && r.notSay.trim() === '段落二'; })());
t('可說明／無法說明（新詞）：合併標題整段當 combined', (() => { const r = extractSayNotSay('## 這次測量可說明／無法說明什麼\n- 可說明 A\n- 無法說明 B\n\n## 其他\nX'); return r.combined != null && /可說明 A/.test(r.combined) && r.say === null && r.notSay === null; })());
t('可說明／無法說明（新詞）：分開標題各自擷取；「無法說明」不得被當成可說明', (() => { const r = extractSayNotSay('## 可說明\n段落一\n\n## 無法說明\n段落二\n\n## 其他\n段落三'); return /段落一/.test(r.say || '') && !/段落二/.test(r.say || '') && /段落二/.test(r.notSay || ''); })());
t('能說／不能說：都找不到回 null', extractSayNotSay('# 標題\n沒有相關段落').say === null && extractSayNotSay('# 標題\n沒有相關段落').notSay === null);

// 核可頁：buildPreview 成本數學（hand-computed：5 題 × 3 組 × 2 次，觸發 8+8×2，矩陣 2 格）
{
  const fakeCfg = {
    name: 'fx', __dir: '/nonexistent-sg-preview-dir', __file: '/nonexistent-sg-preview-dir/gauge.json', __baselineOnly: false,
    skill: { name: 's', path: '../skill/s', __abs: null },
    arms: [{ name: 'a1' }, { name: 'a2' }, { name: 'a3' }],
    executorModel: 'm', executorEffort: null, judgeModel: 'j', runs: 2, allowedTools: [],
    cases: [
      { id: 'c1', type: 'clean', promptFile: 'c1.md', __prompt: 'p1', __materials: [], assertions: ['x'], note: null },
      { id: 'c2', type: 'clean', promptFile: 'c2.md', __prompt: 'p2', __materials: [], assertions: ['x'], note: null },
      { id: 'c3', type: 'pressure', promptFile: 'c3.md', __prompt: 'p3', __materials: [], assertions: ['x'], note: null, rule: 'R', pressures: ['時間'], expectedBehavior: 'comply', expectedOption: null },
      { id: 'c4', type: 'negative', promptFile: 'c4.md', __prompt: 'p4', __materials: [], assertions: ['x'], note: null },
      { id: 'c5', type: 'trap', promptFile: 'c5.md', __prompt: 'p5', __materials: [], assertions: ['x'], note: null },
    ],
    assertions: [{ id: 'x', family: 'fact', text: 'X' }],
    trigger: { runs: 2, should: Array(8).fill('q'), shouldNot: Array(8).fill('q') },
    matrix: [{ executorModel: 'm1' }, { executorModel: 'm2' }],
  };
  const pv = buildPreview(fakeCfg, { gaugeDir: '/nonexistent-sg-preview-dir' });
  // 口徑照引擎：矩陣 2 格（兩個不同模型）→ (30+30)×2＝120；已知答案檢查每模型 4 次×2＝8；自證整份 2 次 → 130；觸發 32 次另計（只在 --with-trigger 才花）
  t('buildPreview 成本：executions/gradings/isolation(依模型數)/selfcheck(一次)/trigger(另計)/matrixCells/totalCalls', pv.cost.executions === 30 && pv.cost.gradings === 30 && pv.cost.isolationChecks === 8 && pv.cost.distinctModels === 2 && pv.cost.graderSelfCheck === 2 && pv.cost.triggerRuns === 32 && pv.cost.matrixCells === 2 && pv.cost.totalCalls === 130);
  { const bo = buildPreview({ ...fakeCfg, __baselineOnly: true, skill: { name: null, path: null, __abs: null }, arms: [{ name: 'with', skill: true }, { name: 'without', skill: false }], matrix: null, trigger: null }, { gaugeDir: '/nonexistent-sg-preview-dir' }); t('buildPreview：baseline-only 只列基準組、成本只算一組', bo.arms.length === 1 && bo.arms[0].kind === 'none' && bo.cost.arms === 1 && bo.cost.executions === 10 && bo.cost.isolationChecks === 2); }
  t('buildPreview：沒有 lock.json → lock.state=none', pv.lock.state === 'none');
  t('buildPreview：沒有 pre-registration.md → prereg.exists=false', pv.prereg.exists === false);
  { // 合併標題（模板預設寫法）必須一路傳到核可頁：extractSayNotSay 抓到 combined 後，buildPreview 不能只帶 say／notSay（08-19 codex 複核抓到的回歸）
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-prev-')); fs.writeFileSync(path.join(tmp, 'pre-registration.md'), '# X\n\n## 這次測量可說明／無法說明什麼（先寫死）\n- 可說明 A\n- 無法說明 B\n\n## 執行規則\n1. x\n');
    const pc = buildPreview(fakeCfg, { gaugeDir: tmp });
    t('buildPreview：合併標題的可說明／無法說明段落有帶到 prereg.combined，且自檢 say-notsay-found=ok', pc.prereg.combined != null && /可說明 A/.test(pc.prereg.combined) && pc.checks.find((c) => c.id === 'say-notsay-found')?.ok === true);
    fs.rmSync(tmp, { recursive: true, force: true }); }
  t('buildPreview：checks 含 prereg-exists 且 ok=false', pv.checks.find((c) => c.id === 'prereg-exists')?.ok === false);
}

// 原始摘要（深究用；report.summary 由 plainSummary 產生）：不出現 id、贏輸挑對、主句數字對、停案句、第三組措辭
{
  const rep = { name: 'fx', arms: ['with', 'without', 'reminder'], runsPlanned: 3, baseline: { arm: 'without', verdict: 'CONTINUE' }, cases: [{ id: 'c1' }, { id: 'c2' }],
    totals: { with: { pass: 10, total: 12 }, without: { pass: 7, total: 12 }, reminder: { pass: 6, total: 12 } },
    assertions: { 'judgment-01-keep-tech': { family: 'judgment', text: '技術名詞與檔名／測試名（`fixture`、`rollback`）的英文原文仍出現在重寫中；沒有只剩中文', arms: { with: { pass: 0, total: 3 }, without: { pass: 0, total: 3 } } }, 'fact-x': { family: 'fact', label: '數字沒改', text: '四組數字都保留', arms: { with: { pass: 3, total: 3 }, without: { pass: 1, total: 3 } } }, 'j-y': { family: 'judgment', text: '保留兩層結論，不壓成一層', arms: { with: { pass: 2, total: 3 }, without: { pass: 3, total: 3 } } }, 'o-z': { family: 'orientation', text: '（不計分）有沒有 meta 句', arms: { with: { pass: 1, total: 3 }, without: { pass: 1, total: 3 } } } },
    footprint: { armWith: 'with', fired: 6, known: 6, negativeFired: 2, negativeKnown: 6, cases: [] }, trigger: { should: { n: 15, fired: 14 }, shouldNot: { n: 15, fired: 4 } },
    placebo: [{ arm: 'reminder', pass: '6/12', reminderEffect: -1, contentEffect: 4, totalEffect: 3 }], flags: ['零鑑別：a 兩組全過——測不出差別', '零鑑別：b 兩組全過——測不出差別'], invalidRuns: [], harnessFailures: [], nextSteps: ['改題：零鑑別的檢查項對兩組都測不出差別，把那幾條的題目換成模型會失手的情境，或直接刪掉那條檢查。'], conditions: { executorModel: 'm', judgeModel: 'j' } };
  const sm = plainSummary(rep); const md = summaryMarkdown(sm).join('\n');
  t('摘要：主句數字對、等級「有差」（3/12＝25%）', /12 格裡過 10 格，不帶的過 7 格——多 3 格；翻 4 格就反過來/.test(sm.helped) && /有差/.test(sm.helped) && sm.verdict === 'better');
  t('摘要：不出現任何檢查項 id 或組名代號', !/judgment-01|fact-x|j-y|o-z|\bwith\b|\bwithout\b/.test(md));
  t('摘要：優點在哪用 label／首子句（數字沒改；保留兩層結論不算贏）', sm.wins.length === 1 && /數字沒改：不帶 3 次裡 2 次沒過，帶 skill 全過/.test(sm.wins[0]));
  t('摘要：缺點在哪含帶 skill 反而差、兩組全沒過、誤觸發、一句提醒那組', sm.losses.some((x) => /保留兩層結論.*帶 skill 反而 3 次裡 1 次沒過/.test(x)) && sm.losses.some((x) => /技術名詞與檔名／測試名：帶不帶都 3 次全沒過/.test(x)) && sm.losses.some((x) => /不該出手的題目 6 次裡 2 次/.test(x)) && sm.losses.some((x) => /只給一句提醒那組過 6 格，比不帶還差——skill 的內容比一句提醒多 4 格/.test(x)));
  t('摘要：限制含題數次數模型、零鑑別條數、翻幾格', sm.limits.some((x) => /只有 2 題、每題 3 次/.test(x)) && sm.limits.some((x) => /2 條檢查兩組都全過/.test(x)) && sm.limits.some((x) => /翻 4 格就反轉/.test(x)));
  t('摘要：該怎麼改是人話版改題', sm.next.length === 1 && /^改題：/.test(sm.next[0]) && !/`/.test(sm.next[0]));
  const stop = plainSummary({ ...rep, baseline: { arm: 'without', verdict: 'STOP' }, totals: { without: { pass: 12, total: 12 } } });
  t('摘要：停案句', stop.verdict === 'stop' && /測不出 skill 的貢獻/.test(stop.helped));
  t('assertionLabel：label 優先；沒有就取首子句、超長截在頓號', assertionLabel({ label: 'L', text: 'T' }) === 'L' && assertionLabel({ text: '技術名詞與檔名／測試名（`fixture`）仍出現' }) === '技術名詞與檔名／測試名' && /…$/.test(assertionLabel({ text: '抽象英文詞 hypothesis、falsified、root cause、state leakage、measure、next action 沒有原文照抄' })));
  const R = await import('./render.mjs');
  // 含 decisionFirst 的真實 report 形狀（08-19 codex 複核 5.2：HTML 測試樣本要含 decisionFirst，才驗證得到新區塊真的排第一）
  const repWithCost = { ...rep, cost: { with: { runs: 6 }, without: { runs: 6 }, reminder: { runs: 6 } } };
  const decisionFirst = decisionFirstLines(repWithCost);
  t('decisionFirstLines 對這份真實 report 形狀能算出完整版型（不缺欄位炸掉）：七行固定＋三路線建議', decisionFirst.length >= 10 && ['【結論】', '【成功率】', '【情境地圖】', '【效果】', '【穩度】', '【成本】', '【邊界】', '【建議·改 skill】', '【建議·改用法】', '【建議·發掘】'].every((tag) => decisionFirst.some((l) => l.startsWith(tag))));
  const h = R.renderReportHtml({ ...repWithCost, summary: sm, decisionFirst, generatedAt: 'T', similarity: [], runs: [], sensitivity: { delta: 3, flipsToErase: 3, flipsToReverse: 4, note: '' }, lock: { ok: true, lockedAt: 'L' } }, {});
  t('render：決策摘要排在最前，原始摘要（深究用）在其後、先看這裡在更後（含四問：優點在哪／缺點在哪／該怎麼改）',
    h.indexOf('決策摘要') >= 0 && h.indexOf('決策摘要') < h.indexOf('原始摘要（深究用）') && h.indexOf('原始摘要（深究用）') < h.indexOf('先看這裡') && /有沒有幫上忙/.test(h) && /優點在哪/.test(h) && !/贏在哪/.test(h));
  t('render：原始摘要（深究用）區塊仍完整保留在決策摘要之後（沒有被拿掉，只是不再排第一）', /有沒有幫上忙/.test(h.slice(h.indexOf('原始摘要（深究用）'))));
}

// buildReport 聚合層整合測試（fixture 型，08-19 codex 複核 5.1 必改）：
// 直接在磁碟寫 meta.json／grading.json／output.md，跑真正的 buildReport，驗證六種 run 的成本層分類，
// 以及分類「不影響」既有計分（totals）——這是 AC「分類前後 totals／summary 不變」的回歸證明。
{
  const writeRunFixture = (outDir, caseId, armName, rk, meta, grading) => {
    const runDir = path.join(outDir, 'runs', caseId, armName, `r${rk}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'output.md'), '受測產出\n');
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
    if (grading) fs.writeFileSync(path.join(runDir, 'grading.json'), JSON.stringify(grading, null, 2));
  };
  const baseMeta = (extra) => ({ case: extra.case, arm: extra.arm, run: 1, sandbox: 'sb', ok: true, timedOut: false, exitCode: 0, startedAt: 't', executorModel: null, effort: null, durationMs: 1000, outputTokens: 50, inputTokens: 100, costUsd: 0.01, models: ['m'], mainModel: 'm', numTurns: 1, skillFired: null, toolNames: [], artifacts: [], ...extra });
  const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-buildreport-'));
  const cfgA = {
    __dir: '/nonexistent-sg-buildreport-dir', __file: '/nonexistent-sg-buildreport-dir/gauge.json', name: 'fx-buildreport', runs: 1,
    arms: [{ name: 'with', skill: true }, { name: 'without', skill: false }],
    assertions: [{ id: 'gate-a', family: 'gate', text: 'gate a' }, { id: 'fact-x', family: 'fact', text: 'fact x' }],
    cases: [
      { id: 'succ', type: null, assertions: ['gate-a', 'fact-x'] },
      { id: 'gatefalse', type: null, assertions: ['gate-a', 'fact-x'] },
      { id: 'gatenull', type: null, assertions: ['gate-a', 'fact-x'] },
      { id: 'nogate', type: null, assertions: ['fact-x'] },
      { id: 'metafail', type: null, assertions: ['gate-a', 'fact-x'] },
      { id: 'nogradefile', type: null, assertions: ['gate-a', 'fact-x'] },
    ],
  };
  // 1. 成功：gate-a 明確 pass=true
  writeRunFixture(bdir, 'succ', 'with', 1, baseMeta({ case: 'succ', arm: 'with', costUsd: 0.01 }), { case: 'succ', arm: 'with', run: 'r1', judgeModel: 'j', harnessFailure: false, missing: [], gateFailed: false, verdicts: [{ id: 'gate-a', pass: true, evidence: 'e' }, { id: 'fact-x', pass: true, evidence: 'e' }] });
  // 2. 有效但未成功：gate-a 明確 pass=false（既有 gateFailed／invalid 分類）
  writeRunFixture(bdir, 'gatefalse', 'with', 1, baseMeta({ case: 'gatefalse', arm: 'with', costUsd: 0.02 }), { case: 'gatefalse', arm: 'with', run: 'r1', judgeModel: 'j', harnessFailure: false, missing: [], gateFailed: true, verdicts: [{ id: 'gate-a', pass: false, evidence: 'e' }, { id: 'fact-x', pass: true, evidence: 'e' }] });
  // 3. 無法判定：gate-a 回 null（沒失敗也沒全過）
  writeRunFixture(bdir, 'gatenull', 'with', 1, baseMeta({ case: 'gatenull', arm: 'with', costUsd: 0.03 }), { case: 'gatenull', arm: 'with', run: 'r1', judgeModel: 'j', harnessFailure: false, missing: [], gateFailed: false, verdicts: [{ id: 'gate-a', pass: null, evidence: '判不出來' }, { id: 'fact-x', pass: true, evidence: 'e' }] });
  // 4. 無法判定：這題沒有 gate 斷言
  writeRunFixture(bdir, 'nogate', 'with', 1, baseMeta({ case: 'nogate', arm: 'with', costUsd: 0.015 }), { case: 'nogate', arm: 'with', run: 'r1', judgeModel: 'j', harnessFailure: false, missing: [], gateFailed: false, verdicts: [{ id: 'fact-x', pass: false, evidence: 'e' }] });
  // 5. 前置作廢：meta 失敗（執行失敗；grading 仍寫 harnessFailure，跟既有 gradeAll 行為一致）——花費仍記，成本入分子
  writeRunFixture(bdir, 'metafail', 'with', 1, baseMeta({ case: 'metafail', arm: 'with', ok: false, exitCode: 1, costUsd: 0.05 }), { case: 'metafail', arm: 'with', run: 'r1', harnessFailure: true, verdicts: [] });
  // 6. 前置作廢：缺 grading（grade 步驟還沒跑）——花費仍記，成本入分子
  writeRunFixture(bdir, 'nogradefile', 'with', 1, baseMeta({ case: 'nogradefile', arm: 'with', costUsd: 0.025 }), null);

  const repA = buildReport(cfgA, bdir);
  const cw = repA.cost.with;
  // 場景全對制的已知答案（先按定義手推，再對實作）：
  //   succ        gate=true、fact=true            → 全部預期檢查明確 pass → 場景全對
  //   gatefalse   gate=false、fact=true           → 有一條明確 false      → 有效但未成功
  //   gatenull    gate=null、fact=true            → 沒有明確 false、有 null → 無法判定
  //   nogate      （只有 fact）fact=false          → 有一條明確 false      → 有效但未成功（舊制是「沒有 gate＝無法判定」，語義改版後改這裡）
  //   metafail    meta.ok=false                   → 前置作廢
  //   nogradefile 缺 grading.json                 → 前置作廢
  //   ⇒ 全對 1、有效但未成功 2、無法判定 1、前置作廢 2；全對率＝1/(1+2)=1/3
  t('buildReport 分類：場景全對 1（succ）', cw.successRuns === 1);
  t('buildReport 分類：有效但未成功 2（gatefalse 的 gate 明確 false；nogate 的 fact 明確 false）', cw.notFirstPassRuns === 2);
  t('buildReport 分類：無法判定 1（gatenull：沒有明確 false、但 gate 回 null）', cw.indeterminateRuns === 1);
  t('buildReport 分類：前置作廢 2（metafail、nogradefile）', cw.discardedRuns === 2);
  t('buildReport 分類：discardedRunIds 只裝前置作廢，不含 gate 明確 false 的 run（B1）', repA.discardedRunIds.length === 2 && repA.discardedRunIds.every((x) => /metafail|nogradefile/.test(x)) && repA.invalidRuns.some((x) => /gatefalse/.test(x)));
  t('buildReport 成本：Σ costUsd 含作廢與失敗＝0.15，6 個 run 全部有記錄→ complete', Math.abs(cw.sumCostUsd - 0.15) < 1e-9 && cw.costRecorded === 6 && cw.costTotal === 6 && cw.costComplete === true);
  t('buildReport 成本：每次全對的成本＝0.15/1=0.15、每過格成本＝0.15/2=0.075、全對率＝1/(1+2)=1/3', Math.abs(cw.perSuccessCostUsd - 0.15) < 1e-9 && Math.abs(cw.perPassedCheckCostUsd - 0.075) < 1e-9 && Math.abs(cw.firstPassRate - 1 / 3) < 1e-9);
  t('buildReport 分類不影響計分（AC-2 回歸）：totals 只由既有 fact/judgment 記分邏輯決定＝2/3（succ 過、gatenull 過、nogate 不過；gatefalse 因 gateFailed continue 不進計分）', repA.totals.with.pass === 2 && repA.totals.with.total === 3);
  t('buildReport 成本：完全沒有 run 的臂（without）→ 空集合回 null，不是 0（AC-1「空集合絕不算 0」）', repA.cost.without.sumCostUsd === null && repA.cost.without.costRecorded === 0 && repA.cost.without.costTotal === 0 && repA.cost.without.successRuns === 0);
  {
    const R = await import('./render.mjs');
    const hCost = R.renderReportHtml(repA, {});
    t('render 深究成本表：呈現分類（場景全對／有效但未成功／無法判定／前置作廢）與每格派生成本、一次到位 proxy', /深究：成本派生欄/.test(hCost) && /場景全對（AI 評分）/.test(hCost) && /有效但未成功/.test(hCost) && /無法判定/.test(hCost) && /前置作廢/.test(hCost) && /proxy：1\/3/.test(hCost));
  }
  fs.rmSync(bdir, { recursive: true, force: true });
}

// buildReport 缺值路徑（部分缺）整合測試：兩個 run 都場景全對，但其中一個沒記到 costUsd——
// 總成本／兩個 USD 派生欄都要回不完整，但一次到位率（只跟 gate 分類有關）不受影響，totals 也不受影響
{
  const writeRunFixture = (outDir, caseId, armName, rk, meta, grading) => {
    const runDir = path.join(outDir, 'runs', caseId, armName, `r${rk}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'output.md'), '受測產出\n');
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(runDir, 'grading.json'), JSON.stringify(grading, null, 2));
  };
  const bdir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-buildreport-partial-'));
  const cfgB = {
    __dir: '/nonexistent-sg-buildreport-partial-dir', __file: '/nonexistent-sg-buildreport-partial-dir/gauge.json', name: 'fx-partial', runs: 1,
    arms: [{ name: 'with', skill: true }, { name: 'without', skill: false }],
    assertions: [{ id: 'gate-b', family: 'gate', text: 'gate b' }, { id: 'fact-y', family: 'fact', text: 'fact y' }],
    cases: [{ id: 'p1', type: null, assertions: ['gate-b', 'fact-y'] }, { id: 'p2', type: null, assertions: ['gate-b', 'fact-y'] }],
  };
  const mk2 = (c, cost) => ({ case: c, arm: 'with', run: 1, sandbox: 'sb', ok: true, timedOut: false, exitCode: 0, startedAt: 't', executorModel: null, effort: null, durationMs: 500, outputTokens: 10, inputTokens: 20, costUsd: cost, models: ['m'], mainModel: 'm', numTurns: 1, skillFired: null, toolNames: [], artifacts: [] });
  const grading2 = (c) => ({ case: c, arm: 'with', run: 'r1', judgeModel: 'j', harnessFailure: false, missing: [], gateFailed: false, verdicts: [{ id: 'gate-b', pass: true, evidence: 'e' }, { id: 'fact-y', pass: true, evidence: 'e' }] });
  writeRunFixture(bdir2, 'p1', 'with', 1, mk2('p1', 0.02), grading2('p1'));
  writeRunFixture(bdir2, 'p2', 'with', 1, mk2('p2', null), grading2('p2')); // 缺 costUsd

  const repB = buildReport(cfgB, bdir2);
  const cwB = repB.cost.with;
  t('buildReport 缺值（部分）：總成本回 null，誠實回報 recorded=1/total=2', cwB.sumCostUsd === null && cwB.costRecorded === 1 && cwB.costTotal === 2 && cwB.costComplete === false);
  t('buildReport 缺值（部分）：兩個 USD 派生欄都回 null（不冒充只算那筆 0.02 的完整數字）', cwB.perSuccessCostUsd === null && cwB.perPassedCheckCostUsd === null);
  t('buildReport 缺值（部分）：一次到位率不受成本缺值影響，仍算得出 2/(2+0)=1（跟 gate 分類無關）', Math.abs(cwB.firstPassRate - 1) < 1e-9 && cwB.successRuns === 2 && cwB.notFirstPassRuns === 0);
  t('buildReport 缺值（部分）：totals 不受成本缺值影響＝2/2', repB.totals.with.pass === 2 && repB.totals.with.total === 2);
  t('buildReport 缺值（部分）：report.flags 標「成本記錄不完整」（AC-1 要求 report 要標 recorded/total）', repB.flags.some((f) => /成本記錄不完整：with（1\/2）/.test(f)));
  fs.rmSync(bdir2, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 管線級已知答案測試（08-19 codex 第二輪 B9／裁定 v1.3-6）：
// 真的寫 meta.json／grading.json 到磁碟 → buildReport → decisionFirstLines → reportMarkdown／renderReportHtml，
// 每一條都先按定義手推預期值（寫在註解），再拿去對實作；不是把實作的輸出抄成斷言。
// ---------------------------------------------------------------------------
{
  const R = await import('./render.mjs');
  const tmpDirs = [];
  const mkRun = (outDir, caseId, arm, rk, meta, grading) => {
    const runDir = path.join(outDir, 'runs', caseId, arm, rk);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'output.md'), `受測產出 ${caseId}/${arm}/${rk}\n`); // 逐 run 不同：避免觸發「同格 run 高度相似」旗標
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
    if (grading) fs.writeFileSync(path.join(runDir, 'grading.json'), JSON.stringify(grading, null, 2));
  };
  const META = (o) => ({ case: o.case, arm: o.arm, run: 1, sandbox: 'sb', ok: true, timedOut: false, exitCode: 0, startedAt: 't', executorModel: null, effort: null, durationMs: 1000, outputTokens: 50, inputTokens: 100, costUsd: 0.01, models: ['m'], mainModel: 'm', numTurns: 1, skillFired: null, toolNames: [], artifacts: [], ...o });
  const GRADE = (caseId, arm, rk, verdicts, o = {}) => ({ case: caseId, arm, run: rk, judgeModel: 'j', harnessFailure: false, missing: [], gateFailed: verdicts.some((v) => /^gate/.test(v.id) && v.pass === false), verdicts, ...o });
  // spec：{ caseId: { arm: [ [verdicts, metaOverride] , … ] } }
  const buildFixture = (tag, cfgBase, spec) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sg-pipe-${tag}-`));
    tmpDirs.push(dir);
    for (const [caseId, byArm] of Object.entries(spec)) {
      for (const [arm, runs] of Object.entries(byArm)) {
        runs.forEach((entry, i) => {
          const [verdicts, metaOver = {}, gradeOver = {}] = entry;
          const rk = `r${i + 1}`;
          mkRun(dir, caseId, arm, rk, META({ case: caseId, arm, run: i + 1, ...metaOver }), verdicts === null ? { case: caseId, arm, run: rk, harnessFailure: true, verdicts: [] } : GRADE(caseId, arm, rk, verdicts, gradeOver));
        });
      }
    }
    const cfg = { __dir: `/nonexistent-sg-pipe-${tag}`, __file: `/nonexistent-sg-pipe-${tag}/gauge.json`, ...cfgBase };
    return buildReport(cfg, dir);
  };
  const V = (id, pass) => ({ id, pass, evidence: 'e' });
  const twoArms = [{ name: 'with', skill: true }, { name: 'without', skill: false }];

  // --- B1 管線級：一臂有 gate 明確 false 的 run ---
  // 手推：with＝c1 全對、c2 gate false（有效但未成功）→ 全對 1/2＝50%；without＝c1 全對、c2 fact false → 1/2＝50%。
  //       前置作廢 0 ⇒ 第一層 guard 不擋；計分母體 with 1 格（c2 沒進計分）、without 2 格 ⇒ 第二層說「效果先不判」。
  //       關鍵：整頁不得變成「資料不足」，全對率要正常顯示非 100%。
  {
    const cfgG = { name: 'fx-gatefalse', runs: 1, arms: twoArms,
      assertions: [{ id: 'gate-g', family: 'gate', text: 'gate g' }, { id: 'fact-f', family: 'fact', text: 'fact f', label: '事實 f' }],
      cases: [{ id: 'c1', assertions: ['gate-g', 'fact-f'] }, { id: 'c2', assertions: ['gate-g', 'fact-f'] }] };
    const rep = buildFixture('gatefalse', cfgG, {
      c1: { with: [[[V('gate-g', true), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
      c2: { with: [[[V('gate-g', false), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', false)]]] },
    });
    t('B1 管線：gate 明確 false 只算「有效但未成功」，不進 discardedRunIds', rep.cost.with.notFirstPassRuns === 1 && rep.cost.with.discardedRuns === 0 && rep.discardedRunIds.length === 0 && rep.invalidRuns.length === 1);
    const df = rep.decisionFirst;
    t('B1 管線：有 gate-false run 時第一頁不是「資料不足」', !/資料不足/.test(df.join('')));
    t('B1 管線：全對率正常顯示非 100%（帶 1/2＝50%、不帶 1/2＝50%）', /【成功率】場景全對（AI 評分）：帶 1\/2（50%） vs 不帶 1\/2（50%）/.test(df[1]));
    t('B1 管線：一次到位 proxy 也顯示非 100%', /一次到位（proxy，非人機來回實測）帶 50%（proxy：1\/2） vs 不帶 50%（proxy：1\/2）/.test(df.find((l) => l.startsWith('【成本】'))));
    t('B1 管線：計分母體不同時只讓效果與穩度不判，不擋整頁（結論改走全對率＋成本分流）', /計分格那一層不可比/.test(df[0]) && !/資料不足/.test(df[0]) && /不比格數/.test(df.find((l) => l.startsWith('【效果】'))));
    // 分類不影響計分（回歸）：gate 明確 false 的 run 照舊不進 totals——語義改版只動成本層分類，不動計分
    t('B1 管線：成本層分類不影響計分（totals 仍照既有規則：with 1/1、without 1/2）', rep.totals.with.pass === 1 && rep.totals.with.total === 1 && rep.totals.without.pass === 1 && rep.totals.without.total === 2);
    const md = reportMarkdown(cfgG, rep), h = R.renderReportHtml(rep, {});
    t('B1 管線：Markdown／HTML 全鏈都帶上同一組決策摘要句', md.includes('## 決策摘要') && md.includes('【成功率】場景全對（AI 評分）：帶 1/2（50%）') && h.includes('決策摘要') && h.includes('帶 1/2（50%）'));
  }

  // --- B2 管線級：crossed-null（評分回 null，格子沒判定）---
  // 手推：with 的 c1 fact-f 回 null → 該格沒進 perAssertion，但那個 run 進得了計分（gate 過）⇒ eligible=2、total=1 ⇒ 第一層 guard 擋。
  {
    const cfgN = { name: 'fx-null', runs: 1, arms: twoArms,
      assertions: [{ id: 'gate-g', family: 'gate', text: 'gate g' }, { id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['gate-g', 'fact-f'] }, { id: 'c2', assertions: ['gate-g', 'fact-f'] }] };
    const rep = buildFixture('null', cfgN, {
      c1: { with: [[[V('gate-g', true), V('fact-f', null)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
      c2: { with: [[[V('gate-g', true), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
    });
    t('B2 管線：逐 assertion 記下應計格數（eligible），null 那格算得出洞', rep.assertions['fact-f'].arms.with.eligible === 2 && rep.assertions['fact-f'].arms.with.total === 1);
    t('B2 管線：有格子沒拿到判定→第一頁判資料不足（不是照樣下結論）', /資料不足/.test(rep.decisionFirst[0]) && /沒拿到判定/.test(rep.decisionFirst[0]));
    t('B2 管線：null 判定的 run 算「無法判定」，不算全對也不算未成功', rep.cost.with.indeterminateRuns === 1 && rep.cost.with.successRuns === 1 && rep.cost.with.notFirstPassRuns === 0);
  }

  // --- B3 管線級：兩組實際跑的模型不同 ---
  {
    const cfgM = { name: 'fx-models', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['fact-f'] }, { id: 'c2', assertions: ['fact-f'] }] };
    const rep = buildFixture('models', cfgM, {
      c1: { with: [[[V('fact-f', true)]]], without: [[[V('fact-f', true)], { mainModel: 'm2', models: ['m2'] }]] },
      c2: { with: [[[V('fact-f', true)]]], without: [[[V('fact-f', false)], { mainModel: 'm2', models: ['m2'] }]] },
    });
    t('B3 管線：兩組實際跑的模型不同→資料不足（不比）', /資料不足/.test(rep.decisionFirst[0]) && /實際跑的模型不同/.test(rep.decisionFirst[0]));
  }

  // --- B4 管線級：第三臂完全少跑，不擋主比較 ---
  // 手推：主比較兩臂各 2 次齊全；reminder 只跑 c1（1 次，計畫 2 次）⇒ 主結論照出、第三組獨立標「本臂資料不足」。
  {
    const cfg3 = { name: 'fx-third', runs: 1, arms: [...twoArms, { name: 'reminder', skillPath: 'x' }],
      assertions: [{ id: 'fact-f', family: 'fact', text: 'fact f', label: '事實 f' }],
      cases: [{ id: 'c1', assertions: ['fact-f'] }, { id: 'c2', assertions: ['fact-f'] }] };
    const rep = buildFixture('third', cfg3, {
      c1: { with: [[[V('fact-f', true)]]], without: [[[V('fact-f', false)]]], reminder: [[[V('fact-f', true)]]] },
      c2: { with: [[[V('fact-f', true)]]], without: [[[V('fact-f', false)]]] },
    });
    const df = rep.decisionFirst;
    t('B4 管線：第三臂少跑不擋主比較', !/資料不足/.test(df[0]) && /【成功率】場景全對（AI 評分）：帶 2\/2（100%） vs 不帶 0\/2（0%）/.test(df[1]));
    t('B4 管線：第三臂獨立標註「本臂資料不足」', /【第三組】reminder：本臂資料不足（實跑 1 次、計畫 2 次），不進主比較/.test(df.find((l) => l.startsWith('【第三組】'))));
  }

  // --- B8／C4 管線級：token 部分缺值、USD 極小值、0 成本邊界、負成本 ---
  {
    const cfgT = { name: 'fx-tok', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['fact-f'] }, { id: 'c2', assertions: ['fact-f'] }] };
    // token 部分缺：with 的第二個 run 沒記 inputTokens ⇒ 總和回 null、recorded/total＝1/2；中位數仍算得出來
    const repTok = buildFixture('tok', cfgT, {
      c1: { with: [[[V('fact-f', true)]]], without: [[[V('fact-f', true)]]] },
      c2: { with: [[[V('fact-f', true)], { inputTokens: null }]], without: [[[V('fact-f', true)]]] },
    });
    t('B9 管線：token 部分缺值→總和回 null、recorded/total 誠實回報 1/2（不冒充完整）', repTok.cost.with.sumInputTokens === null && repTok.cost.with.inputTokensRecorded === 1 && repTok.cost.with.inputTokensTotal === 2 && repTok.cost.without.sumInputTokens === 200);
    t('B9 管線：Markdown 深究成本表把 token 不完整寫出來（跟 HTML 同一套說法）', /記錄不完整（1\/2）/.test(reportMarkdown(cfgT, repTok)) && /記錄不完整（1\/2）/.test(R.renderReportHtml(repTok, {})));
    t('B7 管線：門檻寫進 report（可機讀）＋決策摘要／Markdown／HTML 三處都印出門檻字樣', repTok.costFlow.threshold === 0.2 && /≥20% 視為顯著（經驗值，未校準）/.test(repTok.costFlow.note) && [repTok.decisionFirst.join(''), reportMarkdown(cfgT, repTok), R.renderReportHtml(repTok, {})].every((x) => /≥20% 視為顯著（經驗值，未校準）/.test(x)));
    // USD 極小值：with 每次 5e-8（2 次共 1e-7、全對 1 次 → 每次全對 1e-7）、without 每次 1e-7（共 2e-7 → 2e-7）
    const repTiny = buildFixture('tiny', cfgT, {
      c1: { with: [[[V('fact-f', true)], { costUsd: 5e-8 }]], without: [[[V('fact-f', true)], { costUsd: 1e-7 }]] },
      c2: { with: [[[V('fact-f', false)], { costUsd: 5e-8 }]], without: [[[V('fact-f', false)], { costUsd: 1e-7 }]] },
    });
    const costLine = repTiny.decisionFirst.find((l) => l.startsWith('【成本】'));
    t('B8 管線：USD 小到六位也印不出來時寫「<$0.000001（原值 …）」，兩組不會顯示成同一串', /<\$0\.000001（原值 1e-7）/.test(costLine) && /<\$0\.000001（原值 2e-7）/.test(costLine));
    // 0 成本邊界：兩組每次都 0 ⇒ 總和 0（complete）、每次全對成本 0、決策矩陣視為相當
    const repZero = buildFixture('zero', cfgT, {
      c1: { with: [[[V('fact-f', true)], { costUsd: 0 }]], without: [[[V('fact-f', true)], { costUsd: 0 }]] },
      c2: { with: [[[V('fact-f', false)], { costUsd: 0 }]], without: [[[V('fact-f', false)], { costUsd: 0 }]] },
    });
    t('B9 管線：0 成本邊界——總和 0 算「完整」（不是缺值）、每次全對成本 0，決策摘要印 $0.000', repZero.cost.with.sumCostUsd === 0 && repZero.cost.with.costComplete === true && repZero.cost.with.perSuccessCostUsd === 0 && /帶 \$0\.000 vs 不帶 \$0\.000/.test(repZero.decisionFirst.find((l) => l.startsWith('【成本】'))));
    // C4：負成本按缺值處理＋旗標
    const repNeg = buildFixture('neg', cfgT, {
      c1: { with: [[[V('fact-f', true)], { costUsd: -0.5 }]], without: [[[V('fact-f', true)]]] },
      c2: { with: [[[V('fact-f', true)]]], without: [[[V('fact-f', true)]]] },
    });
    t('C4 管線：負的 costUsd 按缺值處理（不進總和、不進派生欄）', repNeg.cost.with.sumCostUsd === null && repNeg.cost.with.costRecorded === 1 && repNeg.cost.with.costTotal === 2 && repNeg.cost.with.perSuccessCostUsd === null);
    t('C4 管線：負的 costUsd 要出旗標，不是靜默吞掉', repNeg.flags.some((f) => /成本數字異常：with 有 1 次/.test(f)));
  }

  // --- 環節效益表四分類（A3）---
  // 手推（每組每題 3 次；1 題）：
  //   o-neg  取向  帶 1/3(.33) vs 不帶 3/3(1.0) → 帶 < 不帶 → 負效益（取向不計分，所以是新旗標「負效益環節」在講它）
  //   f-neg  事實  帶 1/3      vs 不帶 3/3      → 負效益（計分口徑已有「帶 skill 反而較差」旗標，新旗標不重複講）
  //   f-low  事實  帶 0/3      vs 不帶 0/3      → 都 ≤1/3 → 兩邊都低
  //   f-high 事實  帶 3/3      vs 不帶 3/3      → 都 ≥2/3 → 兩邊都高
  //   f-pos  事實  帶 3/3      vs 不帶 1/3(.33) → 不是負效益、不是都低（max=1）、不是都高（min=.33）→ 正效益
  {
    const cfgB = { name: 'fx-benefit', runs: 3, arms: twoArms,
      assertions: [
        { id: 'o-neg', family: 'orientation', text: '取向 neg', label: '取向負效益' },
        { id: 'f-neg', family: 'fact', text: '事實 neg', label: '事實負效益' },
        { id: 'f-low', family: 'fact', text: '事實 low', label: '兩邊都低項' },
        { id: 'f-high', family: 'fact', text: '事實 high', label: '兩邊都高項' },
        { id: 'f-pos', family: 'fact', text: '事實 pos', label: '正效益項' },
      ],
      cases: [{ id: 'c1', assertions: ['o-neg', 'f-neg', 'f-low', 'f-high', 'f-pos'] }] };
    const mk = (oNeg, fNeg, fPos) => [V('o-neg', oNeg), V('f-neg', fNeg), V('f-low', false), V('f-high', true), V('f-pos', fPos)];
    const rep = buildFixture('benefit', cfgB, {
      c1: {
        with: [[mk(true, true, true)], [mk(false, false, true)], [mk(false, false, true)]],
        without: [[mk(true, true, true)], [mk(true, true, false)], [mk(true, true, false)]],
      },
    });
    const kindOf = (id) => rep.benefit.rows.find((x) => x.id === id)?.kind;
    t('A3 環節效益表：四分類逐條對上手推答案（負效益／兩邊都低／兩邊都高／正效益）',
      kindOf('o-neg') === 'negative' && kindOf('f-neg') === 'negative' && kindOf('f-low') === 'bothLow' && kindOf('f-high') === 'bothHigh' && kindOf('f-pos') === 'positive');
    t('A3 環節效益表：負效益排最前（改 skill 時最優先）', rep.benefit.rows[0].kind === 'negative' && rep.benefit.rows[1].kind === 'negative');
    t('A3 環節效益表：樣本每格 3 次＝不算薄，不掛「當線索不當定論」', rep.benefit.thin === false && !/當線索，不當定論/.test(rep.benefit.note));
    // 兩個旗標母體不同（計分格 vs 全預期），不去重：兩個都要在，而且各自標清楚母體（v1.4-9）
    t('A3 環節效益表：負效益雙旗標都出、各自標母體（不去重，去重會把嚴重程度講小）',
      rep.flags.some((f) => f.startsWith('負效益環節：取向負效益') && /all-expectations/.test(f))
      && rep.flags.some((f) => f.startsWith('負效益環節：事實負效益') && /all-expectations/.test(f))
      && rep.flags.some((f) => f.startsWith('帶 skill 反而較差：f-neg') && /scored-population/.test(f)));
    t('A3 環節效益表：分類門檻寫進 report.benefit（外部消費者重建得出分類）', rep.benefit.thresholds.substantiveDiffRuns === 1 && Math.abs(rep.benefit.thresholds.low - 1 / 3) < 1e-9 && Math.abs(rep.benefit.thresholds.high - 2 / 3) < 1e-9 && rep.benefit.thresholds.thinJudgements === 3);
    t('A3 環節效益表：母體說明講清楚跟計分表口徑不同（不會被讀成同一張表）', /前置檢查沒過的 run 也照算/.test(rep.benefit.denominatorNote));
    const md = reportMarkdown(cfgB, rep), h = R.renderReportHtml(rep, {});
    t('A3 環節效益表：Markdown 與 HTML 都出這張表，四類判讀字樣都在', /## 環節效益表/.test(md) && /負效益（帶 skill 反而差）/.test(md) && /兩邊都低/.test(md) && /兩邊都高/.test(md) && /正效益/.test(md) && /環節效益表/.test(h) && /兩邊都高/.test(h));
    // 卡住的預期＝帶 skill 那組沒有全過的檢查項；負效益兩條排最前（同為負效益時照 id 排：f-neg 在 o-neg 前），最多列三條
    t('A3 環節效益表：路線 A 的「卡住的預期檢查」清單從這張表出，負效益排最前並標最優先', /^【建議·改 skill】卡住的預期檢查：事實負效益（帶 1\/3、不帶 3\/3，帶 skill 反而差、最優先）；取向負效益（帶 1\/3、不帶 3\/3，帶 skill 反而差、最優先）；兩邊都低項（帶 0\/3、不帶 0\/3）$/.test(rep.decisionFirst.find((l) => l.startsWith('【建議·改 skill】'))));
    // 樣本薄：同一份設計改成每組每題 2 次 ⇒ thin=true，整表掛警語
    const repThin = buildFixture('benefit-thin', { ...cfgB, name: 'fx-benefit-thin', runs: 2 }, {
      c1: { with: [[mk(true, true, true)], [mk(false, false, true)]], without: [[mk(true, true, true)], [mk(true, true, false)]] },
    });
    t('A3 環節效益表：每格判定數 <3 時整表掛「當線索，不當定論」', repThin.benefit.thin === true && /當線索，不當定論/.test(repThin.benefit.note));
  }

  // --- 三路線建議（A2）各分支 ---
  // 手推（3 題 × 每組 2 次；assertions fact-a／fact-b，全部進計分且兩組母體一致）：
  //   c-good  帶：兩次都 a✓b✓ → 全對 2/2＝100%；不帶：兩次 a✗b✓ → 全對 0/2＝0%
  //   c-mid   帶／不帶都是 r1 a✓b✓、r2 a✓b✗ → 各 1/2＝50%
  //   c-bad   帶／不帶都是 a✓b✗ 兩次 → 各 0/2＝0%
  //   ⇒ 帶 skill 全對率最高＝c-good(100%)、最低＝c-bad(0%)；路線 B 用高低兩端、路線 C 用最高那一題
  {
    const cfgR = { name: 'fx-routes', runs: 2, arms: twoArms,
      assertions: [{ id: 'fact-a', family: 'fact', text: 'fact a', label: '檢查 a' }, { id: 'fact-b', family: 'fact', text: 'fact b', label: '檢查 b' }],
      cases: ['c-good', 'c-mid', 'c-bad'].map((id) => ({ id, assertions: ['fact-a', 'fact-b'] })) };
    const ab = (a, b) => [V('fact-a', a), V('fact-b', b)];
    const rep = buildFixture('routes', cfgR, {
      'c-good': { with: [[ab(true, true)], [ab(true, true)]], without: [[ab(false, true)], [ab(false, true)]] },
      'c-mid': { with: [[ab(true, true)], [ab(true, false)]], without: [[ab(true, true)], [ab(true, false)]] },
      'c-bad': { with: [[ab(true, false)], [ab(true, false)]], without: [[ab(true, false)], [ab(true, false)]] },
    });
    const df = rep.decisionFirst;
    const line = (tag) => df.find((l) => l.startsWith(tag)) || '';
    t('A2 三路線：全對率主行＝三題合計（帶 3/6＝50%、不帶 1/6＝17%）', /【成功率】場景全對（AI 評分）：帶 3\/6（50%） vs 不帶 1\/6（17%）/.test(line('【成功率】')));
    t('A2 三路線：情境地圖點出最高與最低的場景與各自全對率', /^【情境地圖】全對率最高：c-good（帶 2\/2，100%；不帶 0\/2，0%）；最低：c-bad（帶 0\/2，0%；不帶 0\/2，0%）。$/.test(line('【情境地圖】')));
    t('A2 三路線：路線 B 由場景差生成（高的先用、低的先避開或補強）', /^【建議·改用法】先用在全對率高的情境：c-good（帶 2\/2，100%；不帶 0\/2，0%）；全對率低的 c-bad（帶 0\/2，0%；不帶 0\/2，0%） 先避開，或補一段人工複核再交出去。$/.test(line('【建議·改用法】')));
    t('A2 三路線：路線 C 不管使用率高低都報最高成功情境', /【建議·發掘】全對率最高的情境是 c-good（帶 2\/2，100%；不帶 0\/2，0%）——不管現在用得多不多/.test(line('【建議·發掘】')));
    t('A2 三路線：路線 A 列卡住的預期檢查（fact-b 帶 skill 只過一半）', /【建議·改 skill】卡住的預期檢查：檢查 b（帶 3\/6、不帶 3\/6）/.test(line('【建議·改 skill】')));
    t('A2 三路線：Markdown 全鏈帶得出三路線建議', (() => { const md = reportMarkdown(cfgR, rep); return md.includes('【建議·改 skill】') && md.includes('【建議·改用法】') && md.includes('【建議·發掘】'); })());
  }

  // =========================================================================
  // 第三輪複核（v1.4）補的管線級反例：每一條都先按裁定手推預期值（寫在註解），再拿去對實作。
  // =========================================================================

  // --- v1.4-1：【結論】改由場景全對率驅動（複核點名的反例：格數相同、全對率 50% vs 0%）---
  // 手推（2 題 × 每組 1 次；fact-a／fact-b 都計分，每次 $0.01）：
  //   with    c1 a✓b✓（全對；計分 2/2）、c2 a✗b✗（未全對；計分 0/2）→ 計分 2/4、場景全對 1/2＝50%
  //   without c1 a✓b✗（未全對；1/2）、c2 a✗b✓（未全對；1/2）      → 計分 2/4、場景全對 0/2＝0%
  //   ⇒ 通過格數完全相同（2/4）、成本相同：舊制（格數驅動）會走成本分流判「建議退役」；
  //     新制看全對次數差 +1 ⇒ 留用方向。這一格就是「格數不再是判定貨幣」有沒有落地的分水嶺。
  {
    const cfgV = { name: 'fx-verdict', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-a', family: 'fact', text: 'fact a', label: '檢查 a' }, { id: 'fact-b', family: 'fact', text: 'fact b', label: '檢查 b' }],
      cases: [{ id: 'c1', assertions: ['fact-a', 'fact-b'] }, { id: 'c2', assertions: ['fact-a', 'fact-b'] }] };
    const ab = (a, b) => [V('fact-a', a), V('fact-b', b)];
    const rep = buildFixture('verdict', cfgV, {
      c1: { with: [[ab(true, true)]], without: [[ab(true, false)]] },
      c2: { with: [[ab(false, false)]], without: [[ab(false, true)]] },
    });
    t('v1.4-1 前提：兩組通過格數相同（2/4 對 2/4），舊制在這一格分不出方向', rep.totals.with.pass === 2 && rep.totals.with.total === 4 && rep.totals.without.pass === 2 && rep.totals.without.total === 4);
    t('v1.4-1 前提：場景全對率是 50% vs 0%', rep.cost.with.successRuns === 1 && rep.cost.without.successRuns === 0 && rep.cost.with.notFirstPassRuns === 1 && rep.cost.without.notFirstPassRuns === 2);
    const df = rep.decisionFirst;
    t('v1.4-1：【結論】由場景全對率驅動——同樣格數、全對率高的那組判「可留用」，不再判退役', /^【結論】fx-verdict：可留用/.test(df[0]) && /多 1 次/.test(df[0]) && !/退役/.test(df[0]));
    t('v1.4-1：結構化欄位同步（consumer 不必解析中文、不必數陣列位置）', rep.decisionFirstData.verdict.kind === 'keep' && rep.decisionFirstData.driver === 'scenario-rate' && rep.decisionFirstData.scenario.diff === 1 && rep.decisionFirstData.scenario.with.pass === 1 && rep.decisionFirstData.scenario.without.pass === 0);
  }

  // --- v1.4-4：某一臂整組沒過前置檢查（全臂 gate-false）---
  // 手推：with 兩次都 gate✗（fact✓）⇒ 沒有任何計分格、場景全對 0/2＝0%；without 兩次全過 ⇒ 計分 2/2、全對 2/2＝100%。
  //   關鍵：0% 是算得出來的正確數字，不得因為 with 沒有 totals 就把整頁蓋成「資料不足」。
  {
    const cfgA = { name: 'fx-allgate', runs: 1, arms: twoArms,
      assertions: [{ id: 'gate-g', family: 'gate', text: 'gate g' }, { id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['gate-g', 'fact-f'] }, { id: 'c2', assertions: ['gate-g', 'fact-f'] }] };
    const rep = buildFixture('allgate', cfgA, {
      c1: { with: [[[V('gate-g', false), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
      c2: { with: [[[V('gate-g', false), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
    });
    const df = rep.decisionFirst;
    t('v1.4-4 前提：整組沒過前置檢查那臂沒有計分格（totals 缺該臂），但 run 分類齊全', rep.totals.with === undefined && rep.cost.with.successRuns === 0 && rep.cost.with.notFirstPassRuns === 2 && rep.cost.with.discardedRuns === 0);
    t('v1.4-4：全臂沒過前置檢查時成功率 0% 照算，整頁不判資料不足', !/資料不足/.test(df[0]) && /【成功率】場景全對（AI 評分）：帶 0\/2（0%） vs 不帶 2\/2（100%）/.test(df[1]));
    t('v1.4-4：這種情形結論走全對率＝退役方向，【效果】那行才說計分格不可比', /退役方向/.test(df[0]) && /沒有進得了計分的格子/.test(df.find((l) => l.startsWith('【效果】'))));
    t('v1.4-4：成本行照出（沒有全對 run 就老實寫「無全對 run」，不是資料不足）', /帶 無全對 run/.test(df.find((l) => l.startsWith('【成本】'))));
  }

  // --- v1.4-4：交錯的前置檢查沒過（crossed gate-false）---
  // 手推：with 在 c1 gate✗、without 在 c2 gate✗ ⇒ 兩臂 fact-f 各只有 1 格判定（數量相同！），
  //   但一個來自 c2、一個來自 c1——不是同一批 run。舊的「只比數量」放行，keyed 母體才抓得到。
  {
    const cfgC = { name: 'fx-crossed', runs: 1, arms: twoArms,
      assertions: [{ id: 'gate-g', family: 'gate', text: 'gate g' }, { id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['gate-g', 'fact-f'] }, { id: 'c2', assertions: ['gate-g', 'fact-f'] }] };
    const rep = buildFixture('crossed', cfgC, {
      c1: { with: [[[V('gate-g', false), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
      c2: { with: [[[V('gate-g', true), V('fact-f', true)]]], without: [[[V('gate-g', false), V('fact-f', true)]]] },
    });
    t('v1.4-4 前提：交錯 gate-false 讓兩臂的判定格數相同（各 1 格），只有 key 不同', rep.assertions['fact-f'].arms.with.total === 1 && rep.assertions['fact-f'].arms.without.total === 1 && rep.assertions['fact-f'].arms.with.keys[0] === 'c2/r1' && rep.assertions['fact-f'].arms.without.keys[0] === 'c1/r1');
    const df = rep.decisionFirst;
    t('v1.4-4：交錯 gate-false 被逐 assertion×case×run 的 key 比對抓到（效果不判）', /不是同一批 run/.test(df.find((l) => l.startsWith('【效果】'))));
    t('v1.4-4：交錯 gate-false 不擋整頁——全對率照出 1/2 vs 1/2', !/資料不足/.test(df[0]) && /帶 1\/2（50%） vs 不帶 1\/2（50%）/.test(df[1]));
    // 陰性對照：兩臂在「同一格」沒過前置檢查 ⇒ 排除掉的是同一批 run，母體仍可比，【效果】照判
    // 手推：兩臂都在 c1 gate✗ ⇒ 兩臂 fact-f 都只有 c2/r1 一格判定（同一批），計分 1/1 對 1/1 ⇒ 可比。
    const repSame = buildFixture('samegate', { ...cfgC, name: 'fx-samegate' }, {
      c1: { with: [[[V('gate-g', false), V('fact-f', true)]]], without: [[[V('gate-g', false), V('fact-f', true)]]] },
      c2: { with: [[[V('gate-g', true), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', false)]]] },
    });
    t('v1.4-4 陰性對照：兩臂在同一格沒過前置檢查時不算不可比（guard 沒有過度觸發）',
      !/資料不足/.test(repSame.decisionFirst[0]) && !/不是同一批 run/.test(repSame.decisionFirst.join('')) && /【效果】1 格檢查結果/.test(repSame.decisionFirst.find((l) => l.startsWith('【效果】'))));
  }

  // --- v1.4-4：gate／orientation 判定回 null（先前完全沒查的兩個 family）---
  {
    const cfgGN = { name: 'fx-gatenull', runs: 1, arms: twoArms,
      assertions: [{ id: 'gate-g', family: 'gate', text: 'gate g' }, { id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['gate-g', 'fact-f'] }, { id: 'c2', assertions: ['gate-g', 'fact-f'] }] };
    const repG = buildFixture('gatenull', cfgGN, {
      c1: { with: [[[V('gate-g', null), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
      c2: { with: [[[V('gate-g', true), V('fact-f', true)]]], without: [[[V('gate-g', true), V('fact-f', true)]]] },
    });
    t('v1.4-4：前置檢查（gate）判定回 null → 第一頁判資料不足（計分口徑看不到這個洞）', /資料不足/.test(repG.decisionFirst[0]) && /gate-g/.test(repG.decisionFirst[0]) && /判定回 null 或缺判定/.test(repG.decisionFirst[0]));
    const cfgON = { name: 'fx-orientnull', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-f', family: 'fact', text: 'fact f' }, { id: 'orient-o', family: 'orientation', text: 'orient o' }],
      cases: [{ id: 'c1', assertions: ['fact-f', 'orient-o'] }, { id: 'c2', assertions: ['fact-f', 'orient-o'] }] };
    const repO = buildFixture('orientnull', cfgON, {
      c1: { with: [[[V('fact-f', true), V('orient-o', null)]]], without: [[[V('fact-f', true), V('orient-o', true)]]] },
      c2: { with: [[[V('fact-f', true), V('orient-o', true)]]], without: [[[V('fact-f', true), V('orient-o', true)]]] },
    });
    t('v1.4-4：取向觀察（orientation）判定回 null → 一樣判資料不足', /資料不足/.test(repO.decisionFirst[0]) && /orient-o/.test(repO.decisionFirst[0]));
  }

  // --- v1.4-3：重複／未知 verdict id、pass 型別錯 ⇒ 整份 run 前置作廢 ---
  // 手推：with 的 c1 回了兩次 fact-a（先 false 後 true）。舊制照陣列順序取最後一筆＝算成全對；
  //   新制整份 run 判前置作廢：不進全對率分子分母、進 discardedRunIds，第一頁因此判資料不足（作廢沒補跑）。
  {
    const cfgD = { name: 'fx-dup', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-a', family: 'fact', text: 'fact a' }],
      cases: [{ id: 'c1', assertions: ['fact-a'] }, { id: 'c2', assertions: ['fact-a'] }] };
    const repD = buildFixture('dup', cfgD, {
      c1: { with: [[[V('fact-a', false), V('fact-a', true)]]], without: [[[V('fact-a', true)]]] },
      c2: { with: [[[V('fact-a', true)]]], without: [[[V('fact-a', true)]]] },
    });
    t('v1.4-3：重複 verdict id ⇒ 整份 run 前置作廢（不得依陣列順序算成全對）', repD.discardedRunIds.includes('c1/with/r1') && repD.harnessFailures.includes('c1/with/r1') && repD.cost.with.discardedRuns === 1 && repD.cost.with.successRuns === 1 && repD.cost.with.notFirstPassRuns === 0);
    t('v1.4-3：重複 verdict id 會出旗標，講清楚哪一格、為什麼', repD.flags.some((f) => /評分結果不合契約：c1\/with\/r1/.test(f) && /同一條檢查出現兩次以上/.test(f)));
    t('v1.4-3：作廢的 run 進 guard ⇒ 第一頁判資料不足，不拿半份資料下結論', /資料不足/.test(repD.decisionFirst[0]) && /前置作廢/.test(repD.decisionFirst[0]));
    t('v1.4-3：作廢那格不進計分（totals 只剩 c2 的 1 格）', repD.totals.with.total === 1 && repD.totals.with.pass === 1);
    const repU = buildFixture('unknownid', { ...cfgD, name: 'fx-unknownid' }, {
      c1: { with: [[[V('fact-a', true), V('ghost-x', true)]]], without: [[[V('fact-a', true)]]] },
      c2: { with: [[[V('fact-a', true)]]], without: [[[V('fact-a', true)]]] },
    });
    t('v1.4-3：不在預期清單裡的 id ⇒ 整份 run 前置作廢＋旗標', repU.discardedRunIds.includes('c1/with/r1') && repU.flags.some((f) => /不在預期清單裡的檢查 id（ghost-x）/.test(f)));
    const repT = buildFixture('badtype', { ...cfgD, name: 'fx-badtype' }, {
      c1: { with: [[[{ id: 'fact-a', pass: 'yes', evidence: 'e' }]]], without: [[[V('fact-a', true)]]] },
      c2: { with: [[[V('fact-a', true)]]], without: [[[V('fact-a', true)]]] },
    });
    t('v1.4-3：pass 型別不是 true／false／null ⇒ 整份 run 前置作廢＋旗標', repT.discardedRunIds.includes('c1/with/r1') && repT.flags.some((f) => /pass 不是 true／false／null/.test(f)));
    // 回歸（輸入驗證不是計分規則變更）：正常輸入下 totals 與既有規則完全一樣
    const repClean = buildFixture('dupclean', { ...cfgD, name: 'fx-dupclean' }, {
      c1: { with: [[[V('fact-a', true)]]], without: [[[V('fact-a', false)]]] },
      c2: { with: [[[V('fact-a', true)]]], without: [[[V('fact-a', true)]]] },
    });
    t('v1.4-3 回歸：正常輸入不受影響——totals 照舊（with 2/2、without 1/2），沒有多出前置作廢', repClean.totals.with.pass === 2 && repClean.totals.with.total === 2 && repClean.totals.without.pass === 1 && repClean.totals.without.total === 2 && repClean.discardedRunIds.length === 0 && !repClean.flags.some((f) => /不合契約/.test(f)));
  }

  // --- v1.4-4：一側沒記到實際跑的模型 ---
  {
    const cfgM = { name: 'fx-onesidemodel', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['fact-f'] }, { id: 'c2', assertions: ['fact-f'] }] };
    const rep = buildFixture('onesidemodel', cfgM, {
      c1: { with: [[[V('fact-f', true)], { mainModel: null, models: [] }]], without: [[[V('fact-f', true)]]] },
      c2: { with: [[[V('fact-f', true)], { mainModel: null, models: [] }]], without: [[[V('fact-f', true)]]] },
    });
    t('v1.4-4：一側有記模型、一側沒記 ⇒ 資料不足（不能假設是同一個模型跑的）', /資料不足/.test(rep.decisionFirst[0]) && /沒有記到實際跑的模型/.test(rep.decisionFirst[0]));
  }

  // --- v1.4-6：每次全對成本到六位仍碰撞 ---
  // 手推：with＝c1 全對（$1.0000001）＋c2 未全對（$0）⇒ 總 1.0000001／全對 1 次 → 每次全對 $1.0000001；
  //       without 同型但 $1.0000002。六位下兩者都是 $1.000000 ⇒ 必須附原值，不得印成同一串。
  {
    const cfgU = { name: 'fx-collide', runs: 1, arms: twoArms,
      assertions: [{ id: 'fact-f', family: 'fact', text: 'fact f' }],
      cases: [{ id: 'c1', assertions: ['fact-f'] }, { id: 'c2', assertions: ['fact-f'] }] };
    const rep = buildFixture('collide', cfgU, {
      c1: { with: [[[V('fact-f', true)], { costUsd: 1.0000001 }]], without: [[[V('fact-f', true)], { costUsd: 1.0000002 }]] },
      c2: { with: [[[V('fact-f', false)], { costUsd: 0 }]], without: [[[V('fact-f', false)], { costUsd: 0 }]] },
    });
    t('v1.4-6 前提：兩組每次全對的成本只差 1e-7（六位印不出來）', Math.abs(rep.cost.with.perSuccessCostUsd - 1.0000001) < 1e-12 && Math.abs(rep.cost.without.perSuccessCostUsd - 1.0000002) < 1e-12);
    const costLine = rep.decisionFirst.find((l) => l.startsWith('【成本】'));
    t('v1.4-6：六位仍碰撞時兩個值都附原值，不同金額不印成同一串', /原值 1\.0000001/.test(costLine) && /原值 1\.0000002/.test(costLine));
    const md = reportMarkdown(cfgU, rep), h = R.renderReportHtml(rep, {});
    t('v1.4-6：Markdown 與 HTML 的成本欄同樣不碰撞（兩邊共用同一套 formatter）', /原值 1\.0000001/.test(md) && /原值 1\.0000002/.test(md) && /原值 1\.0000001/.test(h) && /原值 1\.0000002/.test(h));
    // 正向對照：新報告該有 v1.2 派生段（下一段的舊報告測試才有意義）
    t('v1.4-5 正向對照：新報告重出 HTML 有成本派生段與場景全對字樣', /深究：成本派生欄/.test(h) && /場景全對/.test(h));
  }

  // --- v1.4-5：舊報告（1.1.x）重出 HTML 不得套入 v1.2 派生語義 ---
  {
    const oldRep = { kind: 'report', engine: '1.1.1', name: 'fx-old', generatedAt: 'T', arms: ['with', 'without'], runsPlanned: 1,
      cases: [{ id: 'c1', type: null, arms: { with: { pass: 1, total: 1, validRuns: 1, invalidRuns: 0, failures: 0 }, without: { pass: 0, total: 1, validRuns: 1, invalidRuns: 0, failures: 0 } } }],
      assertions: { 'fact-f': { family: 'fact', text: 'fact f', arms: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } } } },
      totals: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } },
      cost: { with: { medianDurationS: 1, medianOutputTokens: 10, medianCostUsd: 0.01, runs: 1, models: ['m'] }, without: { medianDurationS: 1, medianOutputTokens: 10, medianCostUsd: 0.01, runs: 1, models: ['m'] } },
      flags: [], similarity: [], invalidRuns: [], harnessFailures: [], nextSteps: ['n'], runs: [],
      sensitivity: { delta: 1, sameDenominator: true, flipsToErase: 1, flipsToReverse: 2, note: '' },
      conditions: { executorModel: 'm', judgeModel: 'j', isolation: [], platform: 'p', node: 'v', claudeVersion: 'c' }, lock: { ok: true, lockedAt: 'L' } };
    const hOld = R.renderReportHtml(oldRep, {});
    // 註：逐題那行的「前置檢查沒過／前置作廢」用語修正對所有報告一體適用（它描述的是既有 invalidRuns 欄位的真實語義），
    // 這裡管的是不得把 v1.2 的派生表與口徑（成本派生欄、場景全對、每次全對的成本）套到沒有那些欄位的舊報告上。
    t('v1.4-5：舊報告沒有場景全對制欄位 ⇒ 重出 HTML 不加成本派生段、不出現場景全對口徑', !/深究：成本派生欄/.test(hOld) && !/場景全對/.test(hOld) && !/每次全對的成本/.test(hOld) && !/成本記錄不完整/.test(hOld));
    t('v1.4-5：舊報告的既有內容照樣出得來（中位數成本表、逐題、逐條斷言）', /每次費用中位數/.test(hOld) && /逐題/.test(hOld) && /fact-f/.test(hOld));
    t('v1.4-5：舊報告沒有環節效益表與決策摘要欄位時不憑空生出來', !/環節效益表/.test(hOld) && !/決策摘要/.test(hOld));
  }

  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
}

// render.mjs 與 gauge.mjs 的美元 formatter 必須是同一套規則（兩邊各留一份複本，這裡逐值對照）
{
  const R = await import('./render.mjs');
  const VALS = [0, 0.001, 0.0021, 0.0024, 0.01, 0.02, 1e-7, 2e-7, 1.5, null, NaN, Infinity];
  let mismatch = 0;
  for (const v of VALS) for (const d of [3, 4, 6]) if (fmtUsd(v, d) !== R.fmtUsd(v, d)) { mismatch++; console.log('   fmtUsd 不一致:', v, d, fmtUsd(v, d), R.fmtUsd(v, d)); }
  for (const set of [[0.02, 0.01], [0.0021, 0.0024], [0.0001, 0.0002], [1e-7, 2e-7], [0.02], []]) if (usdDigits(set) !== R.usdDigits(set)) { mismatch++; console.log('   usdDigits 不一致:', set); }
  t('美元 formatter：render.mjs 與 gauge.mjs 逐值輸出完全相同（B8「互比欄位共用同一 formatter」）', mismatch === 0);
  t('fmtUsd：小到指定位數印不出來就寫「<$…（原值 …）」，不同的值不會變成同一串', fmtUsd(1e-7, 6) === '<$0.000001（原值 1e-7）' && fmtUsd(2e-7, 6) === '<$0.000001（原值 2e-7）' && fmtUsd(0, 3) === '$0.000');
  t('fmtUsd：非有限值回 null（不印出 $NaN／$Infinity）', fmtUsd(NaN, 3) === null && fmtUsd(Infinity, 3) === null && fmtUsd(null, 3) === null);
  // v1.4-6：位數挑到上限（6 位）仍會印成同一串時，整組附原值
  {
    const f = usdFmt([1.0000001, 1.0000002]), fr = R.usdFmt([1.0000001, 1.0000002]);
    t('usdFmt：六位仍碰撞 → 兩個值都附原值，兩串不相同', f(1.0000001) !== f(1.0000002) && /^\$1\.000000（原值 1\.0000001）$/.test(f(1.0000001)) && /^\$1\.000000（原值 1\.0000002）$/.test(f(1.0000002)));
    t('usdFmt：render.mjs 的複本輸出完全相同（碰撞處理兩邊同步）', fr(1.0000001) === f(1.0000001) && fr(1.0000002) === f(1.0000002));
    const g = usdFmt([0.02, 0.01]);
    t('usdFmt：分得開的一組不加原值（不製造雜訊）', g(0.02) === '$0.020' && g(0.01) === '$0.010');
    const h2 = usdFmt([1e-7, 2e-7]);
    t('usdFmt：小到位數上限印不出來時走「<$…（原值 …）」，兩值仍不相同', h2(1e-7) === '<$0.000001（原值 1e-7）' && h2(2e-7) === '<$0.000001（原值 2e-7）');
  }
  t('validCostUsd：只收有限且非負；負值、NaN、Infinity、字串都回 null', validCostUsd(0) === 0 && validCostUsd(1.5) === 1.5 && validCostUsd(-0.1) === null && validCostUsd(NaN) === null && validCostUsd(Infinity) === null && validCostUsd('1') === null);
}

// 評分結果的輸入契約（正式裁定 v1.4-3）純函式已知答案
{
  const v = (id, pass) => ({ id, pass });
  t('verdictContractError：每個 id 恰好一次、pass 是 true／false／null → 合契約（回 null）', verdictContractError(['a', 'b'], [v('a', true), v('b', null)]) === null);
  t('verdictContractError：同一條出現兩次 → 不合契約（[false,true] 不准依順序取值）', /同一條檢查出現兩次以上（a）/.test(verdictContractError(['a'], [v('a', false), v('a', true)]) || ''));
  t('verdictContractError：出現不在預期清單裡的 id → 不合契約', /不在預期清單裡的檢查 id（z）/.test(verdictContractError(['a'], [v('a', true), v('z', true)]) || ''));
  t('verdictContractError：pass 型別不對（字串、數字、undefined）→ 不合契約', /pass 不是/.test(verdictContractError(['a'], [v('a', 'true')]) || '') && /pass 不是/.test(verdictContractError(['a'], [v('a', 1)]) || '') && /pass 不是/.test(verdictContractError(['a'], [{ id: 'a' }]) || ''));
  t('verdictContractError：缺了預期檢查的判定 → 不合契約', /缺了預期檢查的判定（b）/.test(verdictContractError(['a', 'b'], [v('a', true)]) || ''));
  t('verdictContractError：不是陣列 → 不合契約', verdictContractError(['a'], null) === '評分結果不是陣列');
  // classifyScenario 本身也要跟順序無關（正常路徑已被上面的契約擋掉，這是第二道）
  t('classifyScenario：同一條重複且值衝突時取最保守（有明確 false 就是沒全對），與陣列順序無關',
    classifyScenario(['a'], [v('a', false), v('a', true)]) === 'notFirstPass' && classifyScenario(['a'], [v('a', true), v('a', false)]) === 'notFirstPass');
}

// classifyScenario 純函式的已知答案（場景全對制的定義本身）
{
  const v = (id, pass) => ({ id, pass });
  t('classifyScenario：全部明確 pass → 場景全對', classifyScenario(['a', 'b'], [v('a', true), v('b', true)]) === 'success');
  t('classifyScenario：任一條明確 false → 有效但未成功（含只有 gate 過、fact 沒過的情形）', classifyScenario(['a', 'b'], [v('a', true), v('b', false)]) === 'notFirstPass');
  t('classifyScenario：沒有明確 false 但有 null → 無法判定', classifyScenario(['a', 'b'], [v('a', true), v('b', null)]) === 'indeterminate');
  t('classifyScenario：既有 false 又有 null → 判得出來沒全對，算有效但未成功（不是無法判定）', classifyScenario(['a', 'b', 'c'], [v('a', false), v('b', null), v('c', true)]) === 'notFirstPass');
  t('classifyScenario：缺判定（評分沒回這一條）視同 null → 無法判定', classifyScenario(['a', 'b'], [v('a', true)]) === 'indeterminate');
  t('classifyScenario：該題一條預期檢查都沒有 → 無法判定（不能算全對）', classifyScenario([], [v('a', true)]) === 'indeterminate');
}

// benefitKind 純函式的已知答案（正式裁定 v1.4-2：先比通過次數差，沒有實質差才看水準）
// 這張表是先按裁定手推的，再拿去對實作：
//   帶 9/10 vs 不帶 10/10 → 差 −1 → 負效益（就算兩邊都很高）
//   帶 3/3  vs 不帶 2/3   → 差 +1 → 正效益（第三輪複核的反例：不得被「兩邊都高」吃掉那 +33 個百分點）
//   帶 1/3  vs 不帶 0/3   → 差 +1 → 正效益（實質差優先於「兩邊都低」）
//   帶 0/3  vs 不帶 0/3   → 差 0、兩邊 ≤1/3 → 兩邊都低
//   帶 3/3  vs 不帶 3/3   → 差 0、兩邊 ≥2/3 → 兩邊都高
//   帶 2/5  vs 不帶 2/5   → 差 0、0.4 落中段 → 中段
//   母體不等：帶 3/3 vs 不帶 2/4（1.0 vs 0.5，差 0.5 ≥ 1/4）→ 正效益；帶 2/4 vs 不帶 1/2（0.5 vs 0.5）→ 中段
{
  const K = (pa, ja, pb, jb) => benefitKind({ passWith: pa, judgedWith: ja, passWithout: pb, judgedWithout: jb });
  t('benefitKind：通過次數差 ≥1 且帶得少 → 負效益（兩邊都很高也一樣）', K(9, 10, 10, 10) === 'negative' && K(0, 2, 1, 2) === 'negative');
  t('benefitKind：通過次數差 ≥1 且帶得多 → 正效益（3/3 vs 2/3 不得判成「兩邊都高」）', K(3, 3, 2, 3) === 'positive' && K(1, 3, 0, 3) === 'positive');
  t('benefitKind：沒有實質差時才看水準——兩邊 ≤1/3 → 兩邊都低', K(0, 3, 0, 3) === 'bothLow' && K(1, 5, 1, 5) === 'bothLow');
  t('benefitKind：沒有實質差時才看水準——兩邊 ≥2/3 → 兩邊都高', K(3, 3, 3, 3) === 'bothHigh' && K(2, 3, 2, 3) === 'bothHigh');
  t('benefitKind：沒有實質差、水準也不高不低 → 中段（不硬塞進都高／都低）', K(2, 5, 2, 5) === 'middling' && K(1, 2, 1, 2) === 'middling');
  t('benefitKind：兩組判定數不同時用比率差（門檻＝一次的比率），不硬減次數', K(3, 3, 2, 4) === 'positive' && K(2, 4, 1, 2) === 'middling');
}

// HTML 渲染器（若存在）：三種都能吐出含關鍵字的 HTML、不含外部資源
try {
  const R = await import('./render.mjs');
  const sample = { kind: 'report', name: 'fx', generatedAt: 'T', arms: ['with', 'without'], runsPlanned: 1, cases: [{ id: 'c1', type: 'trap', arms: { with: { pass: 1, total: 1, validRuns: 1, invalidRuns: 0, failures: 0, skillFired: 1, skillFiredKnown: 1 }, without: { pass: 0, total: 1, validRuns: 1, invalidRuns: 0, failures: 0, skillFired: 0, skillFiredKnown: 0 } } }], assertions: { x: { family: 'fact', text: 'X', arms: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } } } }, totals: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } }, cost: {}, flags: [], similarity: [], invalidRuns: [], harnessFailures: [], sensitivity: { delta: 1, flipsToErase: 1, flipsToReverse: 2, note: '' }, nextSteps: ['n'], conditions: { executorModel: 'm', judgeModel: 'j', isolation: [], platform: 'p', node: 'v', claudeVersion: 'c' }, lock: { ok: true, lockedAt: 'L' }, runs: [{ case: 'c1', arm: 'with', run: 'r1', ok: true, durationMs: 1, verdicts: [{ id: 'x', pass: true, evidence: 'e<b>' }], output: '<script>x</script>', artifacts: [] }] };
  const h1 = R.renderReportHtml(sample, {});
  t('render：報告 HTML 含先看這裡且已 escape', /先看這裡/.test(h1) && !/<script>x<\/script>/.test(h1) && /&lt;script&gt;/.test(h1));
  t('render：報告 HTML 無外部資源', !/(src|href)=["']https?:\/\//.test(h1) && !/@import\s+url\(/.test(h1));
  const h2 = R.renderMatrixHtml(mx, {}); t('render：矩陣 HTML', /m1-default/.test(h2));
  const h3 = R.renderDescribeHtml(dfake, {}); t('render：描述優化 HTML', /held-out|最佳/.test(h3));

  // label 顯示：assertion 有 label 就顯示 label（text 放 title），沒有就照舊顯示 text（回歸）
  const sampleL = { ...sample, assertions: { x: { family: 'fact', text: 'X 給評分者的原文', label: 'X 給人看的白話', arms: { with: { pass: 1, total: 1 }, without: { pass: 0, total: 1 } } } } };
  const hL = R.renderReportHtml(sampleL, {});
  t('render：assertion 有 label 時顯示 label、text 放 title', /X 給人看的白話/.test(hL) && /title="X 給評分者的原文"/.test(hL));
  t('render：assertion 沒有 label 時照舊顯示 text（回歸不變）', /X<\/div>/.test(h1) || />X</.test(h1));

  // mdToHtml：標題／清單／表格／跳脫／不會炸
  t('mdToHtml：標題轉 h2', /<h2>/.test(R.mdToHtml('## 標題')));
  t('mdToHtml：清單轉 li', /<li>/.test(R.mdToHtml('- a\n- b')));
  t('mdToHtml：表格轉 table', /<table>/.test(R.mdToHtml('| a | b |\n|---|---|\n| 1 | 2 |\n')));
  t('mdToHtml：<script> 會被跳脫', /&lt;script&gt;/.test(R.mdToHtml('<script>x</script>')) && !/<script>x<\/script>/.test(R.mdToHtml('<script>x</script>')));
  t('mdToHtml：亂七八糟輸入不會炸', (() => { try { R.mdToHtml(undefined); R.mdToHtml(null); R.mdToHtml(12345); R.mdToHtml('```\n未關閉的圍籬'); R.mdToHtml('| 壞掉的表格\n沒有分隔列'); return true; } catch { return false; } })());

  // renderPreviewHtml：核可頁最小資料
  const minimalPreview = {
    kind: 'preview', name: 'fx', generatedAt: 'T', engine: '1.1.1',
    skill: { name: 's', path: '../skill/s', exists: true, description: 'd' },
    baselineOnly: false,
    arms: [
      { name: 'with', kind: 'skill', what: '受測 skill', path: '../skill/s', description: 'd' },
      { name: 'without', kind: 'none', what: '什麼都不給', path: null, description: null },
    ],
    conditions: { executorModel: 'm', executorEffort: null, judgeModel: 'j', runs: 2, allowedTools: [] },
    cases: [{ id: 'c1', type: 'clean', typeLabel: '乾淨對照題', promptFile: 'c1.md', prompt: '<script>x</script>', materials: [], assertions: ['x'], note: null, pressure: null }],
    assertions: [{ id: 'x', family: 'fact', familyLabel: '事實檢查', text: 'X', label: null, scored: true, implicit: false, cases: ['c1'] }],
    trigger: null, matrix: null,
    cost: { cases: 1, arms: 2, runs: 2, executions: 2, gradings: 2, isolationChecks: 4, graderSelfCheck: 2, triggerRuns: 0, matrixCells: 1, totalCalls: 16, minCallsIfStop: 10, formula: 'f' },
    lock: { state: 'none', lockedAt: null, relocks: 0, engineAtLock: null, diffs: [] },
    prereg: { exists: false, path: '/x/pre-registration.md', markdown: null, say: null, notSay: null },
    checks: [{ id: 'prereg-exists', ok: false, text: '找不到 pre-registration.md。' }],
  };
  const hp = R.renderPreviewHtml(minimalPreview, {});
  t('preview render：含題組／成本估算／核可前自檢', /題組/.test(hp) && /成本估算/.test(hp) && /核可前自檢/.test(hp));
  t('preview render：含題 id', /c1/.test(hp));
  t('preview render：prompt 已跳脫', /&lt;script&gt;/.test(hp) && !/<script>x<\/script>/.test(hp));
  t('preview render：無外部資源', !/(src|href)=["']https?:\/\//.test(hp) && !/@import\s+url\(/.test(hp));
  t('preview render：detectKind 判成 preview', R.detectKind(minimalPreview) === 'preview');
  t('preview render：無 kind 但有 prereg＋cases 且無 totals → detectKind=preview', R.detectKind({ prereg: {}, cases: [] }) === 'preview');
} catch (e) { t('render.mjs 可載入（' + (e?.message || e).toString().slice(0, 80) + '）', false); }

fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(mdir, { recursive: true, force: true });
console.log(`\n${n - bad}/${n} 通過`);
process.exit(bad ? 1 : 0);
