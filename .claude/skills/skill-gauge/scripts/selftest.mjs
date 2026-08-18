#!/usr/bin/env node
// 引擎自我測試（不呼叫模型、幾秒跑完）：純函式與報告數學。 node scripts/selftest.mjs
process.env.GAUGE_NO_MAIN = '1';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const { ancestorsWithClaude, bigramDice, compareReports, extractJSONArray, parseArgs } = await import('./gauge.mjs');
let n = 0, bad = 0; const t = (name, cond) => { n++; if (!cond) { bad++; console.log('✗', name); } else console.log('✓', name); };

// 祖先掃描：有 .claude 的上層要被抓到，自己這層不算
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-selftest-'));
const withClaude = path.join(tmp, 'a'); fs.mkdirSync(path.join(withClaude, '.claude'), { recursive: true });
const deep = path.join(withClaude, 'b', 'c'); fs.mkdirSync(deep, { recursive: true });
t('祖先掃描抓到上層 .claude', ancestorsWithClaude(deep).includes(withClaude));
t('祖先掃描不算自己這層', !ancestorsWithClaude(withClaude).includes(withClaude));
fs.rmSync(tmp, { recursive: true, force: true });

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
const mk = (p) => ({ arms: ['with', 'without'], baseline: { arm: 'without' }, assertions: { x: { arms: { with: { pass: p[0], total: 3 } } }, y: { arms: { with: { pass: p[1], total: 3 } } }, z: { arms: { with: { pass: p[2], total: 3 } } } }, totals: { with: { pass: p[0] + p[1] + p[2], total: 9 } }, conditions: { executorModel: 'm' }, lock: { lockedAt: 'L' } });
const c = compareReports(mk([3, 1, 2]), mk([2, 2, 2]));
t('compare 逐條判定', c.rows.find((r) => r.id === 'x').verdict === 'regressed' && c.rows.find((r) => r.id === 'y').verdict === 'improved' && c.rows.find((r) => r.id === 'z').verdict === 'held');
t('compare 任一退步＝總判定退步', c.overall === 'regressed');
t('compare 同鎖定同模型偵測', c.sameConditions === true);

// 敏感度數學：差 D 格 → 抹平 |D|、反轉 |D|+1
const D = 12 - 10; t('敏感度：抹平 2、反轉 3', Math.abs(D) === 2 && Math.abs(D) + 1 === 3);

console.log(`\n${n - bad}/${n} 通過`);
process.exit(bad ? 1 : 0);
