#!/usr/bin/env node
// skill-gauge 量測引擎（v1）— 單檔、零依賴、Node ≥ 18，macOS／Linux／Windows 通用。
//
//   node scripts/gauge.mjs check-isolation [--skill <dir>] [--root <dir>]
//   node scripts/gauge.mjs lock    --config <gauge.json>
//   node scripts/gauge.mjs trigger --config <gauge.json> --out <dir> [--runs N]
//   node scripts/gauge.mjs run     --config <gauge.json> --out <dir> [--runs N] [--root <dir>] [--parallel N]
//   node scripts/gauge.mjs grade   --out <dir> [--judge-model <model>]
//   node scripts/gauge.mjs report  --out <dir>
//   node scripts/gauge.mjs all     --config <gauge.json> --out <dir> [--with-trigger]
//
// 每一次執行都是隔離的新程序：不在家目錄底下的暫存目錄、只放受測 skill、
// --setting-sources project --strict-mcp-config、CLAUDE_CODE_DISABLE_AUTO_MEMORY=1。
// 兩組（帶 skill／不帶）拿到逐字相同的 prompt 與材料，唯一差別是 .claude/skills/ 裡有沒有受測 skill。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const ISOLATION_FLAGS = ['--setting-sources', 'project', '--strict-mcp-config'];
const ISOLATION_ENV = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const GRADE_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const GRADER_INPUT_CAP = 60_000;

// ---------- 小工具 ----------
const log = (...a) => console.error('[gauge]', ...a);
const die = (msg, code = 1) => { console.error('[gauge] ✗ ' + msg); process.exit(code); };
const nowStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const rand = () => crypto.randomBytes(3).toString('hex');
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function listFilesRec(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFilesRec(p, base));
    else out.push(path.relative(base, p));
  }
  return out.sort();
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// 目錄與它的每一層上層都不能有 .claude/（自己這一層除外）
function ancestorsWithClaude(dir) {
  const hits = [];
  let d = path.resolve(dir);
  let parent = path.dirname(d);
  while (parent !== d) {
    if (fs.existsSync(path.join(parent, '.claude'))) hits.push(parent);
    d = parent; parent = path.dirname(d);
  }
  return hits;
}

function defaultRoot() {
  const t = os.tmpdir();
  const home = os.homedir();
  const rel = path.relative(home, t);
  const underHome = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (underHome) return null; // Windows 的 %TEMP% 在使用者目錄底下，不能用
  return t;
}

function resolveRoot(explicit) {
  const root = explicit || defaultRoot();
  if (!root) die('系統暫存目錄在你的家目錄底下（Windows 的 %TEMP% 就是），請用 --root 指定一個家目錄以外的資料夾，例如 --root D:\\sg');
  fs.mkdirSync(root, { recursive: true });
  const hits = ancestorsWithClaude(path.join(root, 'probe'));
  if (hits.length) die(`隔離目錄的上層有 .claude/，不能用：${hits.join(', ')}。換一個 --root。`);
  return root;
}

function makeSandbox(root, tag) {
  const dir = path.join(root, `sg-${tag}-${rand()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 執行 claude -p：prompt 走 stdin（避開 Windows 引號問題），輸出 stream-json 以便偵測工具呼叫
function runClaude({ cwd, prompt, model, isolate = true, allowedTools = [], permissionMode = 'acceptEdits', timeoutMs = RUN_TIMEOUT_MS, extraArgs = [] }) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (isolate) args.push(...ISOLATION_FLAGS);
    if (model) args.push('--model', model);
    if (permissionMode) args.push('--permission-mode', permissionMode);
    if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
    args.push(...extraArgs);
    const env = { ...process.env, ...(isolate ? ISOLATION_ENV : {}) };
    const t0 = Date.now();
    const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: IS_WIN });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const events = [];
      for (const line of stdout.split('\n')) {
        const s = line.trim(); if (!s.startsWith('{')) continue;
        try { events.push(JSON.parse(s)); } catch { /* ignore */ }
      }
      const result = events.find((e) => e.type === 'result') || null;
      const toolUses = [];
      for (const e of events) {
        if (e.type !== 'assistant' || !e.message?.content) continue;
        for (const b of e.message.content) if (b.type === 'tool_use') toolUses.push({ name: b.name, input: b.input });
      }
      const mu = result?.modelUsage || null;
      resolve({
        ok: !!result && !result.is_error && code === 0,
        exitCode: code,
        text: result?.result ?? '',
        durationMs: result?.duration_ms ?? Date.now() - t0,
        outputTokens: result?.usage?.output_tokens ?? null,
        inputTokens: (result?.usage?.input_tokens ?? 0) + (result?.usage?.cache_read_input_tokens ?? 0) + (result?.usage?.cache_creation_input_tokens ?? 0) || null,
        costUsd: result?.total_cost_usd ?? null,
        models: mu ? Object.keys(mu) : [],
        mainModel: mu ? Object.entries(mu).sort((a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0)).map(([k, v]) => v?.canonicalModel || k)[0] : null,
        numTurns: result?.num_turns ?? null,
        toolUses,
        stderr: stderr.slice(-4000),
        timedOut: code === null,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function skillFired(toolUses, skillName) {
  for (const t of toolUses) {
    if (t.name === 'Skill') {
      const s = JSON.stringify(t.input || {});
      if (s.includes(skillName)) return true;
    }
    if (t.name === 'Read') {
      const p = String(t.input?.file_path || '');
      if (p.replace(/\\/g, '/').includes(`/skills/${skillName}/`)) return true;
    }
  }
  return false;
}

// ---------- 設定檔 ----------
function loadConfig(p) {
  if (!p) die('缺 --config <gauge.json>');
  const cfg = readJSON(p);
  cfg.__file = path.resolve(p);
  cfg.__dir = path.dirname(cfg.__file);
  const need = ['name', 'skill', 'cases', 'assertions'];
  for (const k of need) if (!cfg[k]) die(`gauge.json 缺 ${k}`);
  if (!cfg.skill.name || !cfg.skill.path) die('gauge.json 的 skill 要有 name 與 path（含 SKILL.md 的資料夾）');
  cfg.skill.__abs = path.resolve(cfg.__dir, cfg.skill.path);
  if (!fs.existsSync(path.join(cfg.skill.__abs, 'SKILL.md'))) die(`找不到 ${cfg.skill.__abs}/SKILL.md`);
  cfg.runs = Number(cfg.runs || 3);
  cfg.arms = cfg.arms || [{ name: 'with', skill: true }, { name: 'without', skill: false }];
  for (const arm of cfg.arms) if (arm.skillPath) arm.__abs = path.resolve(cfg.__dir, arm.skillPath);
  for (const c of cfg.cases) {
    if (!c.id || !c.promptFile) die(`case 缺 id 或 promptFile：${JSON.stringify(c)}`);
    c.__prompt = fs.readFileSync(path.resolve(cfg.__dir, c.promptFile), 'utf8');
    c.__materials = (c.materials || []).map((m) => path.resolve(cfg.__dir, m));
    for (const m of c.__materials) if (!fs.existsSync(m)) die(`材料不存在：${m}`);
    c.assertions = c.assertions || cfg.assertions.filter((a) => !a.cases || a.cases.includes(c.id)).map((a) => a.id);
  }
  const ids = new Set(cfg.assertions.map((a) => a.id));
  for (const c of cfg.cases) for (const id of c.assertions) if (!ids.has(id)) die(`case ${c.id} 引用不存在的斷言 ${id}`);
  for (const a of cfg.assertions) if (!['gate', 'fact', 'judgment', 'orientation'].includes(a.family)) die(`斷言 ${a.id} 的 family 必須是 gate/fact/judgment/orientation`);
  return cfg;
}

function lockInputs(cfg) {
  const entries = [];
  const add = (label, abs) => entries.push({ label, sha256: sha256(fs.readFileSync(abs)) });
  add('gauge.json', cfg.__file);
  const pre = path.join(cfg.__dir, 'pre-registration.md');
  if (fs.existsSync(pre)) add('pre-registration.md', pre);
  for (const rel of listFilesRec(cfg.skill.__abs)) add(`skill/${rel}`, path.join(cfg.skill.__abs, rel));
  for (const arm of cfg.arms) if (arm.__abs) for (const rel of listFilesRec(arm.__abs)) add(`arm-${arm.name}/${rel}`, path.join(arm.__abs, rel));
  for (const c of cfg.cases) { add(`case/${c.id}/prompt`, path.resolve(cfg.__dir, c.promptFile)); c.__materials.forEach((m, i) => add(`case/${c.id}/material-${i}`, m)); }
  return { lockedAt: new Date().toISOString(), entries };
}

function verifyLock(cfg, lockPath) {
  if (!fs.existsSync(lockPath)) return { ok: false, reason: '沒有 lock.json——先執行 lock（預先登錄核可後）' };
  const lock = readJSON(lockPath);
  const now = lockInputs(cfg);
  const diffs = [];
  const m = new Map(lock.entries.map((e) => [e.label, e.sha256]));
  for (const e of now.entries) { if (!m.has(e.label)) diffs.push(`新增：${e.label}`); else if (m.get(e.label) !== e.sha256) diffs.push(`改過：${e.label}`); m.delete(e.label); }
  for (const k of m.keys()) diffs.push(`消失：${k}`);
  return { ok: diffs.length === 0, diffs, lockedAt: lock.lockedAt };
}

// ---------- 已知答案檢查 ----------
const Q_RULES = '你載入的全域行為規則對回應語言有什麼要求？若沒有任何全域規則被載入，只回答 NO-RULES';
const qSkill = (name) => `你的可用 skill 清單裡有沒有 ${name}？只回答 YES 或 NO`;

async function checkIsolation({ root, skillDir, skillName, executorModel }) {
  const results = { root, ancestors: ancestorsWithClaude(path.join(root, 'probe')), items: [] };
  const sb = makeSandbox(root, 'canary');
  // 1. 規則題：同目錄兩臂只差開關
  const noflags = await runClaude({ cwd: sb, prompt: Q_RULES, model: executorModel, isolate: false, permissionMode: null, timeoutMs: GRADE_TIMEOUT_MS });
  const flags = await runClaude({ cwd: sb, prompt: Q_RULES, model: executorModel, isolate: true, permissionMode: null, timeoutMs: GRADE_TIMEOUT_MS });
  const flagsNo = /NO-RULES/.test(flags.text.trim());
  const noflagsNo = /^\s*NO-RULES\s*$/.test(noflags.text.trim());
  results.items.push({
    canary: 'rules', sandbox: sb,
    noflags: noflags.text.slice(0, 300), flags: flags.text.slice(0, 300),
    verdict: !flags.ok || !noflags.ok ? 'harness-failure' : flagsNo && !noflagsNo ? 'PASS' : flagsNo && noflagsNo ? 'INCONCLUSIVE(此帳號沒有全域規則可當已知答案)' : 'FAIL',
  });
  // 2. skill 題：有放 skill 的目錄應答 YES、沒放的應答 NO（都帶開關）
  if (skillDir && skillName) {
    const withDir = makeSandbox(root, 'canary-with');
    copyDir(skillDir, path.join(withDir, '.claude', 'skills', skillName));
    const withoutDir = makeSandbox(root, 'canary-without');
    const yes = await runClaude({ cwd: withDir, prompt: qSkill(skillName), model: executorModel, isolate: true, permissionMode: null, timeoutMs: GRADE_TIMEOUT_MS });
    const no = await runClaude({ cwd: withoutDir, prompt: qSkill(skillName), model: executorModel, isolate: true, permissionMode: null, timeoutMs: GRADE_TIMEOUT_MS });
    const y = /YES/i.test(yes.text) && !/\bNO\b/.test(yes.text.replace(/YES/gi, ''));
    const n = /\bNO\b/.test(no.text) && !/YES/i.test(no.text);
    results.items.push({ canary: 'skill', withSandbox: withDir, withoutSandbox: withoutDir, with: yes.text.slice(0, 200), without: no.text.slice(0, 200), verdict: !yes.ok || !no.ok ? 'harness-failure' : y && n ? 'PASS' : 'FAIL' });
    fs.rmSync(withDir, { recursive: true, force: true }); fs.rmSync(withoutDir, { recursive: true, force: true });
  }
  fs.rmSync(sb, { recursive: true, force: true });
  results.ok = results.items.every((i) => i.verdict === 'PASS' || i.verdict.startsWith('INCONCLUSIVE'));
  results.allPass = results.items.every((i) => i.verdict === 'PASS');
  return results;
}

// ---------- 兩組執行 ----------
async function runOne({ cfg, root, kase, arm, k, outDir }) {
  const sb = makeSandbox(root, `${cfg.name}-${kase.id}-${arm.name}-r${k}`);
  const skillSrc = arm.skill ? cfg.skill.__abs : arm.__abs || null;
  if (skillSrc) copyDir(skillSrc, path.join(sb, '.claude', 'skills', arm.skill ? cfg.skill.name : arm.name));
  for (const m of kase.__materials) fs.copyFileSync(m, path.join(sb, path.basename(m)));
  const before = new Set(listFilesRec(sb));
  const r = await runClaude({ cwd: sb, prompt: kase.__prompt, model: cfg.executorModel, allowedTools: cfg.allowedTools || [] });
  const runDir = path.join(outDir, 'runs', kase.id, arm.name, `r${k}`);
  fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  const created = [];
  for (const rel of listFilesRec(sb)) {
    if (before.has(rel) || rel.startsWith('.claude' + path.sep) || rel.startsWith('.claude/')) continue;
    const abs = path.join(sb, rel);
    if (fs.statSync(abs).size > MAX_ARTIFACT_BYTES) continue;
    const dst = path.join(runDir, 'artifacts', rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(abs, dst); created.push(rel);
  }
  fs.writeFileSync(path.join(runDir, 'output.md'), r.text);
  const meta = {
    case: kase.id, arm: arm.name, run: k, sandbox: sb, ok: r.ok, timedOut: r.timedOut, exitCode: r.exitCode,
    durationMs: r.durationMs, outputTokens: r.outputTokens, inputTokens: r.inputTokens, costUsd: r.costUsd, models: r.models, mainModel: r.mainModel, numTurns: r.numTurns,
    skillFired: skillSrc ? skillFired(r.toolUses, arm.skill ? cfg.skill.name : arm.name) : null,
    toolNames: r.toolUses.map((t) => t.name), artifacts: created, stderrTail: r.ok ? undefined : r.stderr,
  };
  writeJSON(path.join(runDir, 'meta.json'), meta);
  fs.rmSync(sb, { recursive: true, force: true });
  log(`${kase.id} ${arm.name} r${k}: ${r.ok ? 'ok' : 'FAILED'} ${Math.round(r.durationMs / 1000)}s ${r.outputTokens ?? '?'} tok${meta.skillFired === true ? ' skill✓' : meta.skillFired === false ? ' skill✗' : ''}`);
  return meta;
}

async function runAll(cfg, { root, outDir, runs, parallel }) {
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [];
  for (let k = 1; k <= runs; k++) for (const kase of cfg.cases) for (const arm of cfg.arms) jobs.push({ kase, arm, k }); // 交錯：同一次 run 兩組相鄰
  const metas = [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, parallel) }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; metas.push(await runOne({ cfg, root, ...j, outDir })); }
  });
  await Promise.all(workers);
  return metas;
}

// ---------- 觸發測試 ----------
async function runTrigger(cfg, { root, outDir, runs }) {
  const t = cfg.trigger || {};
  const should = t.should || [], shouldNot = t.shouldNot || [];
  if (!should.length && !shouldNot.length) return null;
  const rows = [];
  for (const [kind, list] of [['should', should], ['shouldNot', shouldNot]]) {
    for (const q of list) {
      for (let k = 1; k <= runs; k++) {
        const sb = makeSandbox(root, `${cfg.name}-trigger`);
        copyDir(cfg.skill.__abs, path.join(sb, '.claude', 'skills', cfg.skill.name));
        const r = await runClaude({ cwd: sb, prompt: q, model: cfg.executorModel, allowedTools: cfg.allowedTools || [], timeoutMs: GRADE_TIMEOUT_MS });
        const fired = skillFired(r.toolUses, cfg.skill.name);
        rows.push({ kind, query: q, run: k, fired, ok: r.ok, durationMs: r.durationMs });
        fs.rmSync(sb, { recursive: true, force: true });
        log(`trigger ${kind} r${k} ${fired ? '✓fired' : '·quiet'} — ${q.slice(0, 40).replace(/\n/g, ' ')}`);
      }
    }
  }
  const agg = (kind) => { const rs = rows.filter((r) => r.kind === kind && r.ok); return { n: rs.length, fired: rs.filter((r) => r.fired).length }; };
  const summary = { should: agg('should'), shouldNot: agg('shouldNot'), rows };
  summary.recall = summary.should.n ? summary.should.fired / summary.should.n : null;         // 該觸發時觸發的比例
  summary.falseTriggerRate = summary.shouldNot.n ? summary.shouldNot.fired / summary.shouldNot.n : null; // 不該觸發卻觸發
  writeJSON(path.join(outDir, 'trigger.json'), summary);
  return summary;
}

// ---------- 評分 ----------
function graderPrompt(cfg, kase, runDir) {
  const assertions = cfg.assertions.filter((a) => kase.assertions.includes(a.id));
  const output = fs.readFileSync(path.join(runDir, 'output.md'), 'utf8');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  let artifactsText = '';
  for (const rel of meta.artifacts || []) {
    const p = path.join(runDir, 'artifacts', rel);
    if (!/\.(md|txt|html?|json|csv|yaml|yml)$/i.test(rel)) { artifactsText += `\n--- 檔案 ${rel}（二進位或非文字，未附內容）---\n`; continue; }
    artifactsText += `\n--- 檔案 ${rel} ---\n` + fs.readFileSync(p, 'utf8');
  }
  let body = `=== 受測產出（對話回覆） ===\n${output}\n` + (artifactsText ? `\n=== 受測產出（寫出的檔案） ===${artifactsText}\n` : '');
  let truncated = false;
  if (body.length > GRADER_INPUT_CAP) { body = body.slice(0, GRADER_INPUT_CAP) + '\n…（超過上限，已截斷）'; truncated = true; }
  const materials = kase.__materials.map((m) => `\n--- 材料 ${path.basename(m)} ---\n${fs.readFileSync(m, 'utf8')}`).join('');
  const prompt = `你是評分者。下面有一題任務的原始指令與材料、一份受測產出，以及一組斷言（每條是可以判對錯的檢查句）。
逐條判定每一條斷言在這份產出上是否成立。規則：
- 只依據材料與產出判斷；舉證責任在「通過」那一方——找不到證據就是不通過。
- 每條給 evidence：從產出裡逐字引一小段，或寫「產出中找不到」。
- 表面上有做但做錯、做一半，算不通過。
- 不要猜這份產出是用什麼方法或工具做的，也不要評論方法；只判斷言。
- 只輸出 JSON 陣列，不要任何其他文字：[{"id":"...","pass":true|false,"evidence":"..."}]

=== 原始指令 ===
${kase.__prompt}
${materials ? `\n=== 材料 ===${materials}\n` : ''}
${body}
=== 斷言 ===
${JSON.stringify(assertions.map((a) => ({ id: a.id, text: a.text })), null, 2)}
`;
  return { prompt, truncated, assertionIds: assertions.map((a) => a.id) };
}

function extractJSONArray(text) {
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

async function gradeAll(cfg, { root, outDir, judgeModel }) {
  const runsDir = path.join(outDir, 'runs');
  const gateIds = new Set(cfg.assertions.filter((a) => a.family === 'gate').map((a) => a.id));
  const results = [];
  for (const kase of cfg.cases) {
    for (const arm of cfg.arms) {
      const armDir = path.join(runsDir, kase.id, arm.name);
      if (!fs.existsSync(armDir)) continue;
      for (const rk of fs.readdirSync(armDir).sort()) {
        const runDir = path.join(armDir, rk);
        const gpath = path.join(runDir, 'grading.json');
        if (fs.existsSync(gpath)) { results.push(readJSON(gpath)); continue; }
        const meta = readJSON(path.join(runDir, 'meta.json'));
        if (!meta.ok) { const g = { case: kase.id, arm: arm.name, run: rk, harnessFailure: true, verdicts: [] }; writeJSON(gpath, g); results.push(g); continue; }
        const { prompt, truncated, assertionIds } = graderPrompt(cfg, kase, runDir);
        const sb = makeSandbox(root, 'grader');
        const r = await runClaude({ cwd: sb, prompt, model: judgeModel, permissionMode: null, timeoutMs: GRADE_TIMEOUT_MS });
        fs.rmSync(sb, { recursive: true, force: true });
        const arr = r.ok ? extractJSONArray(r.text) : null;
        const verdicts = Array.isArray(arr) ? arr.filter((v) => assertionIds.includes(v.id)).map((v) => ({ id: v.id, pass: !!v.pass, evidence: String(v.evidence ?? '').slice(0, 500) })) : [];
        const missing = assertionIds.filter((id) => !verdicts.find((v) => v.id === id));
        const g = {
          case: kase.id, arm: arm.name, run: rk, judgeModel, judgeModels: r.models, gradeDurationMs: r.durationMs, truncatedInput: truncated,
          harnessFailure: !r.ok || !Array.isArray(arr) || missing.length > 0, missing, verdicts,
          gateFailed: verdicts.some((v) => gateIds.has(v.id) && !v.pass), rawTail: Array.isArray(arr) ? undefined : r.text.slice(-800),
        };
        writeJSON(gpath, g);
        results.push(g);
        log(`grade ${kase.id} ${arm.name} ${rk}: ${g.harnessFailure ? 'HARNESS-FAILURE' : g.gateFailed ? 'gate✗(invalid)' : verdicts.filter((v) => v.pass).length + '/' + verdicts.length}`);
      }
    }
  }
  return results;
}

// ---------- 報告 ----------
function bigramDice(a, b) {
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(norm(a)), B = grams(norm(b));
  let inter = 0; for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
  const tot = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return tot ? (2 * inter) / tot : 1;
}

function buildReport(cfg, outDir) {
  const runsDir = path.join(outDir, 'runs');
  const scoredIds = cfg.assertions.filter((a) => a.family === 'fact' || a.family === 'judgment').map((a) => a.id);
  const famOf = Object.fromEntries(cfg.assertions.map((a) => [a.id, a.family]));
  const textOf = Object.fromEntries(cfg.assertions.map((a) => [a.id, a.text]));
  const report = { name: cfg.name, generatedAt: new Date().toISOString(), arms: cfg.arms.map((a) => a.name), runsPlanned: cfg.runs, cases: [], assertions: {}, totals: {}, cost: {}, flags: [], similarity: [] };
  const passCount = {}; // arm -> {pass, total}
  const perAssertion = {}; // id -> arm -> {pass,total}
  const perCase = {};
  const invalid = [], harnessFailures = [];
  const durations = {}, outTok = {}, cost = {}, models = {};
  for (const kase of cfg.cases) {
    perCase[kase.id] = {};
    for (const arm of cfg.arms) {
      const armDir = path.join(runsDir, kase.id, arm.name);
      const texts = [];
      perCase[kase.id][arm.name] = { pass: 0, total: 0, validRuns: 0, invalidRuns: 0, failures: 0 };
      if (!fs.existsSync(armDir)) continue;
      for (const rk of fs.readdirSync(armDir).sort()) {
        const runDir = path.join(armDir, rk);
        const meta = readJSON(path.join(runDir, 'meta.json'));
        const gpath = path.join(runDir, 'grading.json');
        const g = fs.existsSync(gpath) ? readJSON(gpath) : null;
        (durations[arm.name] ||= []).push(meta.durationMs); (outTok[arm.name] ||= []).push(meta.outputTokens); (cost[arm.name] ||= []).push(meta.costUsd);
        if (meta.mainModel) (models[arm.name] ||= new Set()).add(meta.mainModel); else for (const m of meta.models || []) (models[arm.name] ||= new Set()).add(m);
        if (!meta.ok || !g || g.harnessFailure) { harnessFailures.push(`${kase.id}/${arm.name}/${rk}`); perCase[kase.id][arm.name].failures++; continue; }
        if (g.gateFailed) { invalid.push(`${kase.id}/${arm.name}/${rk}`); perCase[kase.id][arm.name].invalidRuns++; continue; }
        perCase[kase.id][arm.name].validRuns++;
        texts.push(fs.readFileSync(path.join(runDir, 'output.md'), 'utf8'));
        for (const v of g.verdicts) {
          if (!scoredIds.includes(v.id)) continue;
          const pa = (passCount[arm.name] ||= { pass: 0, total: 0 }); pa.total++; if (v.pass) pa.pass++;
          const pc = perCase[kase.id][arm.name]; pc.total++; if (v.pass) pc.pass++;
          const pas = ((perAssertion[v.id] ||= {})[arm.name] ||= { pass: 0, total: 0 }); pas.total++; if (v.pass) pas.pass++;
        }
      }
      // 同格 run 相似度（有效樣本比 n 小的訊號）
      if (texts.length >= 2) {
        const sims = [];
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) sims.push(bigramDice(texts[i], texts[j]));
        const maxSim = Math.max(...sims), meanSim = sims.reduce((x, y) => x + y, 0) / sims.length;
        report.similarity.push({ case: kase.id, arm: arm.name, pairs: sims.length, mean: +meanSim.toFixed(3), max: +maxSim.toFixed(3) });
        if (meanSim >= 0.8) report.flags.push(`同格 run 高度相似：${kase.id}/${arm.name} 平均相似度 ${meanSim.toFixed(2)}——有效樣本比 ${texts.length} 小`);
      }
    }
  }
  report.cases = cfg.cases.map((c) => ({ id: c.id, type: c.type || null, arms: perCase[c.id] }));
  report.assertions = Object.fromEntries(Object.entries(perAssertion).map(([id, arms]) => [id, { family: famOf[id], text: textOf[id], arms }]));
  report.totals = passCount;
  report.invalidRuns = invalid; report.harnessFailures = harnessFailures;
  report.cost = Object.fromEntries(cfg.arms.map((a) => [a.name, { medianDurationS: median((durations[a.name] || []).map((x) => x / 1000)), medianOutputTokens: median(outTok[a.name] || []), medianCostUsd: median(cost[a.name] || []), runs: (durations[a.name] || []).length, models: [...(models[a.name] || [])] }]));
  // 旗標：零鑑別、skill 有害格、恆不過
  const A = cfg.arms[0]?.name, B = cfg.arms[1]?.name;
  for (const [id, arms] of Object.entries(perAssertion)) {
    const a = arms[A], b = arms[B]; if (!a || !b) continue;
    if (a.pass === a.total && b.pass === b.total) report.flags.push(`零鑑別：${id} 兩組全過——測不出差別`);
    if (a.pass === 0 && b.pass === 0) report.flags.push(`恆不過：${id} 兩組全不過——判斷標準可能太嚴或量到別的東西`);
    if (a.total && b.total && a.pass / a.total < b.pass / b.total) report.flags.push(`帶 skill 反而較差：${id}（${A} ${a.pass}/${a.total} vs ${B} ${b.pass}/${b.total}）`);
  }
  // 前置檢查偏向：作廢集中在某一組＝gate 可能含 skill 專屬格式，兩組不對等
  for (const arm of cfg.arms) {
    const inv = report.cases.reduce((n, c) => n + (c.arms[arm.name]?.invalidRuns || 0), 0);
    const tot = report.cases.reduce((n, c) => n + (c.arms[arm.name]?.invalidRuns || 0) + (c.arms[arm.name]?.validRuns || 0), 0);
    if (tot && inv / tot >= 0.5) report.flags.push(`前置檢查偏向：${arm.name} 組有 ${inv}/${tot} 次因前置檢查作廢——前置檢查可能寫成了 skill 專屬的格式要求，兩組不對等；改成兩組都做得到的檢查（例如「有整理成會議記錄」而不是「有三區」）`);
  }
  if (A && B && passCount[A] && passCount[B]) {
    const D = passCount[A].pass - passCount[B].pass;
    report.sensitivity = { delta: D, flipsToErase: Math.abs(D), flipsToReverse: Math.abs(D) + 1, note: '一格翻轉＝任一組任一格通過↔不通過；差距在個位數時，一兩格就能翻盤' };
  }
  const trig = path.join(outDir, 'trigger.json');
  if (fs.existsSync(trig)) report.trigger = readJSON(trig);
  const iso = path.join(outDir, 'isolation.json');
  if (fs.existsSync(iso)) report.isolation = readJSON(iso);
  const lock = path.join(cfg.__dir, 'lock.json');
  report.lock = fs.existsSync(lock) ? verifyLock(cfg, lock) : { ok: false, reason: '無 lock.json' };
  report.conditions = { executorModel: cfg.executorModel || '(帳號預設)', judgeModel: cfg.judgeModel || null, isolation: [...ISOLATION_FLAGS, 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1', '沙箱不在家目錄底下'], platform: `${process.platform} ${os.release()}`, node: process.version, claudeVersion: report.isolation?.claudeVersion || null };
  return report;
}

function reportMarkdown(cfg, r) {
  const arms = r.arms;
  const L = [];
  L.push(`# skill-gauge 報告 — ${r.name}`, '', `產生時間：${r.generatedAt}`, '');
  // 先看這裡：用資料生成的白話摘要（描述性）
  L.push('## 先看這裡（描述性，只限這次條件）', '');
  const tA = r.totals[arms[0]], tB = r.totals[arms[1]];
  if (tA && tB) {
    L.push(`- 計分的檢查項：${arms[0]} 通過 ${tA.pass}/${tA.total}，${arms[1]} 通過 ${tB.pass}/${tB.total}。差 ${r.sensitivity.delta} 格；只要翻 ${r.sensitivity.flipsToReverse} 格結論就反過來${Math.abs(r.sensitivity.delta) <= 2 ? '——這個差距很小，不要當成定論' : ''}。`);
  } else L.push('- 兩組還沒有可比的計分格（有 run 作廢或失敗）。');
  const zero = r.flags.filter((f) => f.startsWith('零鑑別')).length, hurt = r.flags.filter((f) => f.startsWith('帶 skill 反而')).length, sim = r.flags.filter((f) => f.startsWith('同格')).length, bias = r.flags.filter((f) => f.startsWith('前置檢查偏向')).length;
  if (zero) L.push(`- 有 ${zero} 條檢查項兩組全過：這些項目測不出 skill 的差別（可能模型本來就會，或題目太鬆）。`);
  if (hurt) L.push(`- 有 ${hurt} 條檢查項帶 skill 那組反而較差，逐條看下面的表。`);
  if (sim) L.push(`- 有 ${sim} 個格子的重複 run 幾乎一樣，有效樣本比次數少。`);
  if (bias) L.push(`- 前置檢查作廢集中在某一組，兩組不對等，先修前置檢查再下結論。`);
  const cA = r.cost[arms[0]], cB = r.cost[arms[1]];
  if (cA && cB && cA.medianDurationS != null && cB.medianDurationS != null) L.push(`- 成本：${arms[0]} 每次約 ${cA.medianDurationS.toFixed(0)} 秒／${cA.medianOutputTokens ?? '?'} 輸出 token；${arms[1]} 約 ${cB.medianDurationS.toFixed(0)} 秒／${cB.medianOutputTokens ?? '?'}。`);
  if (r.trigger) L.push(`- 觸發：該觸發時 ${r.trigger.should.fired}/${r.trigger.should.n} 次有觸發；不該觸發時 ${r.trigger.shouldNot.fired}/${r.trigger.shouldNot.n} 次誤觸發。`);
  if (r.invalidRuns.length || r.harnessFailures.length) L.push(`- 有 ${r.invalidRuns.length} 次作廢、${r.harnessFailures.length} 次執行／評分失敗，補跑前數字不完整。`);
  L.push('- 這些都是描述，不是因果；能不能說「skill 有用」，看 pre-registration 寫死的「能說／不能說」。', '');
  L.push('## 條件', '', `| 項目 | 值 |`, `|---|---|`);
  L.push(`| 執行模型（設定／實際） | ${r.conditions.executorModel} ／ ${arms.map((a) => `${a}: ${(r.cost[a]?.models || []).join(',') || '?'}`).join('；')} |`);
  L.push(`| 評分模型 | ${r.conditions.judgeModel || '?'} |`, `| 隔離 | ${r.conditions.isolation.join('、')} |`, `| 平台 | ${r.conditions.platform}；node ${r.conditions.node}；claude ${r.conditions.claudeVersion || '?'} |`);
  L.push(`| 已知答案檢查 | ${r.isolation ? r.isolation.items.map((i) => `${i.canary}: ${i.verdict}`).join('；') : '未跑'} |`);
  L.push(`| 輸入鎖定（預先登錄＋skill＋題目） | ${r.lock.ok ? `一致（${r.lock.lockedAt}）` : '不一致或未鎖：' + (r.lock.reason || r.lock.diffs.join('；'))} |`, '');
  L.push('## 總表（只計事實紀律／判斷紀律；前置檢查不計分、取向觀察不計分）', '', `| 組 | 通過／總格數 |`, `|---|---|`);
  for (const a of arms) L.push(`| ${a} | ${r.totals[a] ? `${r.totals[a].pass}/${r.totals[a].total}` : '—'} |`);
  if (r.sensitivity) L.push('', `差距（${arms[0]} − ${arms[1]}）＝ ${r.sensitivity.delta}；抹平要翻 ${r.sensitivity.flipsToErase} 格、反轉要翻 ${r.sensitivity.flipsToReverse} 格。${r.sensitivity.note}`);
  L.push('', '## 逐題', '', `| 題 | 型 | ${arms.map((a) => `${a} 通過／總格（有效 run）`).join(' | ')} |`, `|---|---|${arms.map(() => '---').join('|')}|`);
  for (const c of r.cases) L.push(`| ${c.id} | ${c.type || ''} | ${arms.map((a) => { const x = c.arms[a]; return x ? `${x.pass}/${x.total}（${x.validRuns}${x.invalidRuns ? `，作廢 ${x.invalidRuns}` : ''}${x.failures ? `，失敗 ${x.failures}` : ''}）` : '—'; }).join(' | ')} |`);
  L.push('', '## 逐條斷言', '', `| 斷言 | 類 | ${arms.join(' | ')} |`, `|---|---|${arms.map(() => '---').join('|')}|`);
  for (const [id, x] of Object.entries(r.assertions)) L.push(`| ${id}：${x.text} | ${x.family} | ${arms.map((a) => (x.arms[a] ? `${x.arms[a].pass}/${x.arms[a].total}` : '—')).join(' | ')} |`);
  L.push('', '## 成本', '', `| 組 | 次數 | 時長中位數（秒） | 輸出 token 中位數 | 每次費用中位數（USD） |`, `|---|---|---|---|---|`);
  for (const a of arms) { const c = r.cost[a] || {}; L.push(`| ${a} | ${c.runs ?? 0} | ${c.medianDurationS?.toFixed?.(0) ?? '?'} | ${c.medianOutputTokens ?? '?'} | ${c.medianCostUsd?.toFixed?.(3) ?? '?'} |`); }
  if (r.trigger) L.push('', '## 觸發測試', '', `該觸發：${r.trigger.should.fired}/${r.trigger.should.n} 次觸發（比例 ${r.trigger.recall?.toFixed(2)}）；不該觸發：${r.trigger.shouldNot.fired}/${r.trigger.shouldNot.n} 次誤觸發（比例 ${r.trigger.falseTriggerRate?.toFixed(2)}）`);
  L.push('', '## 天花板與有效樣本檢查', '');
  if (r.similarity.length) { L.push(`| 題／組 | 配對數 | 平均相似度 | 最高 |`, `|---|---|---|---|`); for (const s of r.similarity) L.push(`| ${s.case}/${s.arm} | ${s.pairs} | ${s.mean} | ${s.max} |`); L.push(''); }
  L.push(...(r.flags.length ? r.flags.map((f) => `- ${f}`) : ['- 無旗標']));
  if (r.invalidRuns.length) L.push('', `作廢 run（前置檢查未過，需補跑）：${r.invalidRuns.join('、')}`);
  if (r.harnessFailures.length) L.push('', `執行或評分失敗（不算受測物的結果，需補跑）：${r.harnessFailures.join('、')}`);
  L.push('', '## 這張表能說與不能說', '', '- 能說的只有上面的描述性數字，而且只限這次的條件。', '- 不能說：因果通則、外推到題組之外的任務、跨模型比較。詳細措辭以 pre-registration 的「能說／不能說」為準。', '- 有旗標的地方，結論要跟著旗標一起講。');
  return L.join('\n') + '\n';
}

// ---------- 主程式 ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!['check-isolation', 'lock', 'trigger', 'run', 'grade', 'report', 'all'].includes(cmd)) die('用法：node scripts/gauge.mjs <check-isolation|lock|trigger|run|grade|report|all> …（見檔頭）');
  const claudeVersion = await new Promise((res) => { const c = spawn('claude', ['--version'], { shell: IS_WIN }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(o.trim())); c.on('error', () => res(null)); });
  if (!claudeVersion) die('找不到 claude 指令，請先安裝並登入 Claude Code');

  if (cmd === 'check-isolation') {
    const root = resolveRoot(args.root);
    const skillDir = args.skill ? path.resolve(args.skill) : null;
    const skillName = skillDir ? path.basename(skillDir) : null;
    const r = await checkIsolation({ root, skillDir, skillName, executorModel: args.model });
    r.claudeVersion = claudeVersion;
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) die('已知答案檢查未通過——先停，別往下跑。最常見原因：隔離目錄的上層有 .claude/。');
    return;
  }
  const cfg = ['lock', 'trigger', 'run', 'grade', 'report', 'all'].includes(cmd) ? loadConfig(args.config || (args.out && fs.existsSync(path.join(args.out, 'gauge.json')) ? path.join(args.out, 'gauge.json') : undefined)) : null;
  if (cmd === 'lock') {
    const lock = lockInputs(cfg); writeJSON(path.join(cfg.__dir, 'lock.json'), lock);
    console.log(`已鎖定 ${lock.entries.length} 個輸入 → ${path.join(cfg.__dir, 'lock.json')}`); return;
  }
  const outDir = path.resolve(args.out || path.join(cfg.__dir, 'runs', nowStamp()));
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(path.join(outDir, 'gauge.json'))) fs.copyFileSync(cfg.__file, path.join(outDir, 'gauge.json'));
  const runs = Number(args.runs || cfg.runs);
  if (cmd === 'trigger') { const root = resolveRoot(args.root || cfg.root); const s = await runTrigger(cfg, { root, outDir, runs: Number(args.runs || cfg.trigger?.runs || 3) }); console.log(JSON.stringify(s && { should: s.should, shouldNot: s.shouldNot, recall: s.recall, falseTriggerRate: s.falseTriggerRate }, null, 2)); return; }
  if (cmd === 'run' || cmd === 'all') {
    const lk = verifyLock(cfg, path.join(cfg.__dir, 'lock.json'));
    if (!lk.ok && !args.force) die(`輸入與 lock.json 不一致：${lk.reason || lk.diffs.join('；')}。預先登錄改了就要重新核可＋重新 lock；硬要跑加 --force（報告會標記）。`);
    const root = resolveRoot(args.root || cfg.root);
    const iso = await checkIsolation({ root, skillDir: cfg.skill.__abs, skillName: cfg.skill.name, executorModel: cfg.executorModel });
    iso.claudeVersion = claudeVersion; writeJSON(path.join(outDir, 'isolation.json'), iso);
    if (!iso.ok) die(`已知答案檢查未通過：${iso.items.map((i) => `${i.canary}=${i.verdict}`).join('，')}。停，不開跑。`);
    log(`已知答案檢查：${iso.items.map((i) => `${i.canary}=${i.verdict}`).join('，')}`);
    if (cmd === 'all' && args['with-trigger']) await runTrigger(cfg, { root, outDir, runs: Number(cfg.trigger?.runs || 3) });
    await runAll(cfg, { root, outDir, runs, parallel: Number(args.parallel || 1) });
    if (cmd === 'run') { console.log(`執行完成 → ${outDir}`); return; }
  }
  if (cmd === 'grade' || cmd === 'all') {
    const root = resolveRoot(args.root || cfg.root);
    const judgeModel = args['judge-model'] || cfg.judgeModel;
    if (!judgeModel) die('缺評分模型：gauge.json 的 judgeModel 或 --judge-model');
    await gradeAll(cfg, { root, outDir, judgeModel });
    if (cmd === 'grade') { console.log(`評分完成 → ${outDir}`); return; }
  }
  if (cmd === 'report' || cmd === 'all') {
    const r = buildReport(cfg, outDir);
    writeJSON(path.join(outDir, 'report.json'), r);
    fs.writeFileSync(path.join(outDir, 'report.md'), reportMarkdown(cfg, r));
    console.log(fs.readFileSync(path.join(outDir, 'report.md'), 'utf8'));
    console.log(`→ ${path.join(outDir, 'report.md')}`);
    return;
  }
  die(`用法：node scripts/gauge.mjs <check-isolation|lock|trigger|run|grade|report|all> …（見檔頭）`);
}

main().catch((e) => die(e?.stack || String(e)));
