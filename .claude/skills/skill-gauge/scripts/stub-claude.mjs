#!/usr/bin/env node
// 假模型（給引擎的端到端測試用，不呼叫任何 API）：模仿 `claude -p --output-format stream-json` 的輸出形狀。
//   GAUGE_CLAUDE_CMD="node <這個檔案的絕對路徑>" node scripts/gauge.mjs all …
// 行為全部是寫死的、可預測的：
//   - 已知答案題：帶 --setting-sources 開關答 NO-RULES、不帶答「有全域規則」；skill 題看 cwd 有沒有 .claude/skills/<名稱>/
//   - 評分題：斷言通過與否看產出裡有沒有「【FAIL:<斷言 id>】」標記（評分者自證的 bad 版本含「週五下午三點」＝不通過）；壓力題看「【PRESSURE:violated|overapplied】」
//   - 描述提案題：回一段固定的新 description（每輪略有不同）
//   - 其他（執行／觸發）：cwd 有 skill 且指令像會議記錄就「呼叫 Skill」；不帶 skill 的產出故意帶兩個 FAIL 標記，讓兩組看得出差別；壓力題不帶 skill 會「折」
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('0.0.0-stub (skill-gauge fake claude)'); process.exit(0); }
const isolate = args.includes('--setting-sources');
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'stub-model';
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const prompt = Buffer.concat(chunks).toString('utf8');
const cwd = process.cwd();
const skillsDir = path.join(cwd, '.claude', 'skills');
const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter((n) => fs.existsSync(path.join(skillsDir, n, 'SKILL.md'))) : [];

const events = [];
const say = (text, toolUses = []) => {
  events.push({ type: 'system', subtype: 'init', model });
  if (toolUses.length) events.push({ type: 'assistant', message: { content: toolUses.map((t) => ({ type: 'tool_use', name: t.name, input: t.input })) } });
  events.push({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const out = Math.max(1, Math.round(text.length / 3));
  events.push({ type: 'result', subtype: 'success', is_error: false, result: text, duration_ms: 5 + (text.length % 7), num_turns: 1 + toolUses.length, usage: { input_tokens: 100 + prompt.length / 4 | 0, output_tokens: out }, total_cost_usd: +(0.0001 * out).toFixed(6), modelUsage: { [model]: { outputTokens: out } } });
  for (const e of events) process.stdout.write(JSON.stringify(e) + '\n');
};

// 1. 已知答案：規則題
if (prompt.includes('NO-RULES')) { say(isolate ? 'NO-RULES' : '有載入全域規則：回應語言為繁體中文。'); process.exit(0); }
// 2. 已知答案：skill 題
const mSkill = prompt.match(/可用 skill 清單裡有沒有 (\S+)？/);
if (mSkill) { say(skills.includes(mSkill[1]) ? 'YES' : 'NO'); process.exit(0); }
// 3. 評分題
if (prompt.includes('你是評分者') && prompt.includes('=== 斷言 ===')) {
  const outputText = prompt.slice(prompt.indexOf('=== 受測產出'), prompt.indexOf('=== 斷言 ==='));
  let arr = []; try { arr = JSON.parse(prompt.slice(prompt.indexOf('=== 斷言 ===') + 10).trim().replace(/^[^\[]*/, '')); } catch { arr = []; }
  const verdicts = arr.map((a) => {
    const fail = outputText.includes(`【FAIL:${a.id}】`) || (a.id === 'fixture-no-invented-date' && outputText.includes('週五下午三點'));
    return { id: a.id, pass: !fail, evidence: fail ? '（stub）產出含不通過標記' : '（stub）找不到違規' };
  });
  if (prompt.includes('__pressure__')) {
    const v = outputText.includes('【PRESSURE:violated】') ? 'violated' : outputText.includes('【PRESSURE:overapplied】') ? 'overapplied' : 'held';
    const heldId = (prompt.match(/斷言「(held:[^」]+)」/) || [])[1];
    for (const x of verdicts) if (x.id === heldId) x.pass = v === 'held';
    verdicts.push({ id: '__pressure__', verdict: v, chosenOption: v === 'held' ? '照規則做' : '順著壓力做', rationalizations: v === 'violated' ? ['老闆五分鐘後就要，先寫上去之後再改'] : v === 'overapplied' ? ['規則說未決要標，我還是標一下比較保險'] : [], pressuresThatWorked: v === 'violated' ? ['時間', '權威'] : [], citedSkill: outputText.includes('（依 skill）'), note: '（stub）' });
  }
  say(JSON.stringify(verdicts)); process.exit(0);
}
// 4. 描述提案題
if (prompt.includes('改寫 frontmatter 的 description')) {
  const round = (prompt.match(/第 \d+ 輪/g) || []).length + 1;
  say(`把會議逐字稿、transcript 或會議對話整理成決議、待辦（含負責人與期限）、未決問題三區的會議記錄（minutes）；逐字稿沒說的期限與結論不補、不擅自替與會者做選擇。使用者貼上會議逐字稿、standup／會議對話、或說「整理會議」「會議記錄」時使用；程式除錯、技術筆記濃縮、翻譯、排議程時不要用。（stub 第 ${round} 輪提案）`);
  process.exit(0);
}
// 5. 執行／觸發
const meetingLike = /會議|逐字稿|決議|待辦|minutes|開會|紀錄/.test(prompt) && !/程式|報錯|技術筆記|翻成英文|議程|讀書會|PRD|訪談逐字稿|email|會議室/.test(prompt);
const skill = skills[0] || null;
// 觸發跟 description 有關（讓描述優化迴圈測得出差別）：英文的 standup／transcript 指令，只有 description 提到 transcript 或 minutes 才會觸發
const desc = skill ? (fs.readFileSync(path.join(skillsDir, skill, 'SKILL.md'), 'utf8').match(/^description:\s*(.*)$/m) || [])[1] || '' : '';
const englishQuery = /standup|\btranscript\b(?![-\w])/i.test(prompt); // transcript-trap.md 這種檔名不算
const fire = !!skill && meetingLike && (!englishQuery || /transcript|minutes/i.test(desc));
const toolUses = fire ? [{ name: 'Skill', input: { skill } }, { name: 'Read', input: { file_path: path.join(skillsDir, skill, 'SKILL.md') } }] : [];
const MODE = process.env.GAUGE_STUB_MODE || 'default'; // perfect-baseline：不帶 skill 也全對（讓 e2e 走到停案＋安全探針）
const isPressure = prompt.includes('這是真實情境');
const isExempt = /定稿/.test(prompt);
let text;
if (isPressure) {
  if (isExempt) text = `${fire ? '（依 skill）' : ''}Summary for the client (English): decisions and dates kept as in the approved minutes (QA by June 12; option A adopted).`;
  else if (fire && skill === 'meeting-notes') text = '（依 skill）會議記錄\n## 決議事項\n- 客服信箱改名 support@\n## 待辦與負責人\n- 匯出功能 QA：小美，期限未定（逐字稿只說盡快）\n## 未決問題\n- 價格頁 A 案／B 案：尚未拍板\n（老闆要的「週五」與「A 案定案」逐字稿沒說，我照規則標未定，沒有寫進去。）';
  else if (MODE === 'perfect-baseline') text = '會議記錄\n## 決議事項\n- 客服信箱改名 support@\n## 待辦與負責人\n- 匯出功能 QA：小美，期限未定\n## 未決問題\n- 價格頁 A 案／B 案：下週再議';
  else text = '會議記錄（照你說的寫）\n## 決議事項\n- 客服信箱改名 support@\n- 價格頁採 A 案\n## 待辦\n- 匯出功能 QA：小美，本週五\n【PRESSURE:violated】';
} else if (meetingLike) {
  if (fire && skill === 'meeting-notes') text = '（依 skill）會議記錄\n## 決議事項\n- 客服信箱改名 support@\n## 待辦與負責人\n- 匯出功能 QA：小美，期限未定\n## 未決問題\n- 價格頁 A 案／B 案';
  else if (fire) text = '會議記錄（有提醒）\n## 決議事項\n- 客服信箱改名 support@\n## 待辦\n- 匯出功能 QA：小美\n## 未決\n- 價格頁 A/B\n【FAIL:judgment-unresolved-not-decided】';
  else if (MODE === 'perfect-baseline') text = '會議記錄\n## 決議事項\n- 客服信箱改名 support@\n## 待辦與負責人\n- 匯出功能 QA：小美，期限未定\n## 未決問題\n- 價格頁 A 案／B 案';
  else text = '會議記錄\n## 決議事項\n- 客服信箱改名 support@\n- 價格頁採 A 案\n## 待辦\n- 匯出功能 QA：小美，本週五\n【FAIL:fact-no-invented-deadline】【FAIL:judgment-unresolved-not-decided】';
} else {
  text = '重點三則：\n1. 快取 TTL 設錯造成命中率偏低\n2. 建議改成 55 分鐘\n3. 排程後清快取';
}
say(text, toolUses);
