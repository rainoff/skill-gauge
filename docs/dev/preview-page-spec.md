# Spec: `preview` — the approval page (v1.1.1)

> ⟦superseded 2026-08-21⟧ Layout and wording updated by preview v2 (three-questions-first; see maintainer's private `gauge/preview-v2-dev/spec.md`). This file stays as the v1.1.1 historical record; 翻車-era wording herein is pre-README-finalization.

Status: implementation spec for the `feat/preview-page` branch. Human-facing docs stay in Traditional Chinese; this file is the execution plan (English on purpose: it is read by the implementing agent, not by end users).

## Why

Maintainer feedback while dogfooding the v1.1 flow (2026-08-18): after the six questions, the skill prints `pre-registration.md` in full and asks "可以嗎？". That wall of text is unreadable for the person who has to approve it. Two decisions follow:

1. **The approval step must show a human-readable page**, not raw execution files. The page is generated deterministically from the files (no LLM), so it is available to everyone who has the engine — no dependency on the maintainer's private visualization skills (viz-explain / artifact-design). Those may be used *in addition* when present.
2. **The artifact is separate from the execution files.** Files (`gauge.json`, `pre-registration.md`, prompts, materials, skill) remain the source of truth; `lock` hashes files, never the page. Execution files may be written in English (cheaper, more precise for the executor/grader); the page and the report speak the user's language.

## Deliverables (all in this worktree, branch `feat/preview-page`)

| File | Change |
|---|---|
| `.claude/skills/skill-gauge/scripts/gauge.mjs` | new subcommand `preview`; exported `buildPreview(cfg, opts)`; `label` support on assertions; `ENGINE_VERSION = '1.1.1'` |
| `.claude/skills/skill-gauge/scripts/render.mjs` | `renderPreviewHtml(data)`, `mdToHtml(md)` (exported), `detectKind` → `'preview'`, `renderHtml` dispatch; report/case/output sections show `label ?? text` |
| `.claude/skills/skill-gauge/scripts/selftest.mjs` | tests for `mdToHtml`, `renderPreviewHtml`, `buildPreview` cost math, label display |
| `.claude/skills/skill-gauge/scripts/e2e-stub.mjs` | run `preview` on the fixture (before and after lock) and assert on the HTML |
| `.claude/skills/skill-gauge/SKILL.md` | Step 3 rewritten around the approval page; Step 2 gets the language rule |
| `README.md` | "最快的用法" step 2 mentions the approval page (one sentence) |
| `docs/testing.md` | new 履歷 row (fill in the real selftest / e2e counts after running them) |
| `docs/roadmap.md` | one bullet under the v1.2 list marking 核可頁 as done (dated 2026-08-18) |
| `.gitignore` | ignore `gauge/*/preview.html` and `exercises/fixtures/*/gauge/preview.html` |

Do not touch: `templates/`, `examples/`, `exercises/01-*.md`, anything under `.claude-plugin/`.

## 1. `preview` subcommand (gauge.mjs)

```
node scripts/gauge.mjs preview --config <gauge.json> [--out <file.html>] [--open]
```

- Add `'preview'` to `COMMANDS`. Dispatch it in `main()` **before** the `claude --version` probe (same place as `html`), because approval happens before anything is run and must work on a machine without `claude`.
- Requires `--config`; uses `loadConfig` (validation errors are the same as everywhere else).
- Does **not** require `lock.json`. Reports the lock state instead (see `lock` below).
- Default output path: `<gauge dir>/preview.html`. `--out` overrides (absolute or relative to cwd). Print the absolute path to stdout as the last line (`→ <path>`), so the skill can echo it.
- `--open`: open the file with the platform opener — macOS `open <file>`, Windows `cmd /c start "" <file>`, Linux `xdg-open <file>` — via `spawn` with `detached: true, stdio: 'ignore'` and `.unref()`; swallow every error (log a one-line warning). Never block on it.
- Never writes anything except the HTML (no `preview.json` on disk by default; expose the data through the exported function for tests).

### `buildPreview(cfg, { gaugeDir })` → data object

```js
{
  kind: 'preview', engine: ENGINE_VERSION, generatedAt, name: cfg.name,
  gaugeFile, gaugeDir,
  skill: { name, path, exists, description },   // description = frontmatter `description` of the skill's SKILL.md, first 240 chars; null when baseline-only
  baselineOnly: cfg.__baselineOnly,
  arms: [{ name, kind: 'skill' | 'none' | 'path', what, path, description }],
        // what (zh): 受測 skill ／ 什麼都不給 ／ 第三組：<path 的 SKILL.md description 前 120 字>
  conditions: { executorModel, executorEffort, judgeModel, runs, allowedTools },
  cases: [{ id, type, typeLabel, promptFile, prompt, materials: [{ name, bytes, head }], assertions: [ids], note,
            pressure: { rule, pressures, expectedBehavior, expectedOption } | null }],
        // head = first 600 chars of the material (utf8, best effort; binary → null)
  assertions: [{ id, family, familyLabel, text, label, scored, implicit, cases: [ids] }],
  trigger: { runs, should: [...], shouldNot: [...] } | null,
  matrix: [{ executorModel, effort }] | null,
  cost: { cases, arms, runs, executions, gradings, isolationChecks, graderSelfCheck, triggerRuns, matrixCells,
          totalCalls, minCallsIfStop, formula },
  lock: { state: 'none' | 'locked' | 'mismatch', lockedAt, relocks, engineAtLock, diffs },
  prereg: { exists, path, markdown, say, notSay },   // say / notSay: best-effort section extraction (see below); null when not found
  checks: [{ id, ok: true | false | null, text }],
}
```

Labels (zh): type `trap→陷阱題`, `clean→乾淨對照題`, `negative→負向對照題`, `pressure→壓力題`, else the raw type; family `gate→前置檢查（不計分）`, `fact→事實檢查`, `judgment→判斷檢查`, `orientation→取向觀察（不計分）`. `scored = family ∈ {fact, judgment}`.

Cost (all integers; caliber = what the engine actually spends, corrected 2026-08-18 after critic review):
- `executions = cases × arms × runs` (arms = baseline arm only when the config has no skill)
- `gradings = executions`
- `isolationChecks = (baselineOnly ? 2 : 4) × distinctExecutorModels` (matrix cells with the same model share one check)
- `graderSelfCheck = 2` (once per measurement, copied into matrix cells)
- `triggerRuns = trigger ? (should.length + shouldNot.length) × trigger.runs : 0` — **shown separately, not in totalCalls** (only spent with `--with-trigger` / `describe`)
- `matrixCells = matrix?.length || 1`
- `totalCalls = (executions + gradings) × matrixCells + isolationChecks + graderSelfCheck`
- `minCallsIfStop`: what is spent when the stop rule fires — (baseline arm all cases × runs × 2 + probes (pressure/negative cases) × (arms − 1) × runs × 2) × matrixCells + isolationChecks + graderSelfCheck.
- `formula`: a short zh string spelling the arithmetic with the actual numbers.

Version: the approval page is an additive patch on v1.1 (the talk, README and slides all say v1.1) → `ENGINE_VERSION = '1.1.1'`, `.claude-plugin/plugin.json` version 1.1.1.

Lock: no `lock.json` → `none`; exists and `verifyLock(cfg, lockPath).ok` → `locked` (+ lockedAt, relocks, engineAtLock); exists but mismatch → `mismatch` (+ diffs).

Prereg: read `<gauge dir>/pre-registration.md` if present. `say` / `notSay` / `combined`: scan headings (any level); test the not-say pattern first (`/不能說|cannot say|can't say|must not say|not permitted|what we can('t|not) say/i`), then the say pattern (`/(?<!不)能說|can say|may say|(?<!not )permitted claims|what we can say/i`); the section body runs to the next heading of the same or higher level; keep raw markdown of that body. Headings that match **both** (e.g. "可說明／無法說明") → the whole body goes to `combined` with `combinedHeading` = the heading text (rendered under its own heading, never labelled 能說 alone).（2026-08-19：headings now also match 可說明／可以說明 → say, 無法說明／不可說明／不能說明 → notSay; the old 能說／不能說 forms stay recognised; `combined`／`combinedHeading` are passed through to the page.）

Checks (automated hints — every one must be cheap and deterministic; `ok: null` = not applicable):
- `prereg-exists` — `pre-registration.md` present.
- `say-notsay-found` — `say`, `notSay` or `combined` extracted.
- `has-gate` — at least one `gate` assertion.
- `has-trap`, `has-clean`, `has-negative` — case types present.
- `runs-at-least-3` — `cfg.runs ≥ 3`.
- `prompt-mentions-skill-name` — `ok:false` if any case prompt contains `cfg.skill.name` (case-insensitive) — the shared prompt must not leak the skill; `null` when baseline-only.
- `lock-consistent` — `null` when no lock; `true` when locked; `false` when mismatch.
Text for each is zh, one sentence, written from the reader's point of view (「題目裡沒有出現受測 skill 的名字」 etc.).

### `label` support

`gauge.json` assertions may carry `label` (user-language one-liner) next to `text` (what the grader reads). Engine changes:
- `loadConfig`: accept `label` (string, optional). No validation beyond type.
- `buildReport`: `report.assertions[id].label = a.label || null` (keep `text` as is).
- `graderPrompt`: unchanged — the grader gets `text` only.
- `render.mjs`: wherever an assertion's `text` is displayed (assertion grid, per-case tables, run details), display `label ?? text` and put the other one in a `title=` attribute. Matrix rendering keeps ids.
- `reportMarkdown`: unchanged (it uses ids).

## 2. `renderPreviewHtml(data)` (render.mjs)

Reuse `page`, `section`, `table`, `chip`, `CSS`, `PAGE_JS`. Language of the page: Traditional Chinese (same as report.html). Sections, in this order (each may be null → skipped):

1. **先看這裡** — one paragraph: 量 `<skill>`（路徑）／幾題×幾組×幾次／估 N 次模型呼叫（停案時最少 M 次）／鎖定狀態 chip／自檢 ✓ x ⚠ y. Then a chip row: 執行模型・effort・評分模型・次數・組數・鎖定狀態.
2. **核可前自檢** — table of `checks` (✓ / ⚠ / –, sentence). Below it a static `<ul>` titled 「這五條引擎判不了，請你看完題目後自己確認」: ①題目來自你的翻車案例或 skill 自己的宣稱 ②兩組共用的指令沒有洩題（不含 skill 的核心指令詞） ③前置檢查兩組都做得到（不是 skill 教的格式） ④可說明／無法說明你同意 ⑤成本可以接受.
3. **條件與各組** — conditions table (執行模型／effort／評分模型／每題每組次數／可用工具) + arms table (組名／拿到什麼／路徑).
4. **題組** — table (id／題型／材料／檢查項數／備註) then one `<details>` per case: `<summary>` = id＋題型＋備註; inside: 「兩組共用的指令（逐字）」`<pre>` with the full prompt, then 「材料」 per file: name, size, `<pre>` with `head` (+ 「…（只顯示前 600 字）」 when truncated), pressure block when present (規則／壓力／預期行為／預期選項).
5. **檢查項** — one table per family in the order gate, fact, judgment, orientation: id／文字（label, with text underneath in smaller type when both exist）／適用題／計分？(✓/–)／自動加入？(implicit).
6. **觸發題** — two lists (該觸發／不該觸發) + runs; note that these only run with `--with-trigger` or `describe`.
7. **矩陣** — table of cells (only if `matrix`).
8. **成本估算** — table (執行／評分／已知答案檢查／評分者自證／觸發／矩陣格數／合計) + the `formula` string + one sentence: 「引擎預設先跑不帶 skill 那組，全過就停案，最少只花 M 次」.
9. **可說明／無法說明** — two `<div class="bar">` blocks with `mdToHtml(say)` / `mdToHtml(notSay)`; if neither found: a warning paragraph 「預先登錄裡找不到標題含『能說』『不能說』的段落——核可前請補上」.（2026-08-19：the warning text now names 可說明／無法說明.）
10. **預先登錄全文** — `<details open>` with `mdToHtml(prereg.markdown)`; when the file is missing: warning paragraph（lock 會拒絕，除非 --allow-missing-prereg）.
11. Footer (always): 「這一頁不是核可對象——核可的是檔案。說『可以』之後執行 lock，鎖的是 gauge.json、pre-registration.md、題目、材料、skill 的雜湊；這一頁改了不算數，檔案改了要重出核可頁、重新核可、--relock。」 plus the standard 「沒有連任何外部資源，可離線開」 line.

`mdToHtml(md)`: minimal, safe, never throws. Escape first, then: fenced code blocks (```), ATX headings (`#`..`######`), unordered lists (`-`, `*`), ordered lists (`1.`), pipe tables (header + `|---|` separator + rows), blockquotes (`>`), inline `**bold**`, `` `code` ``, paragraphs (blank-line separated). Anything unrecognised falls through as a paragraph. On any exception return `<pre>${esc(md)}</pre>`. Export it.

`detectKind`: `kind === 'preview'` → `'preview'`; fallback: has `prereg` and `cases` and no `totals` → `'preview'`. `renderHtml` dispatches to `renderPreviewHtml`.

## 3. SKILL.md

Replace the current 第 3 步 with (keep the heading style of the file):

```
## 第 3 步：停——出核可頁給人看，說「可以」才鎖定（不可跳過）

不要把 pre-registration.md 全文貼在對話裡——那是執行檔，給引擎與你自己用的；給人核可的是一頁整理過的核可頁：
```
node <SKILL_DIR>/scripts/gauge.mjs preview --config gauge/<dir>/gauge.json --open
```
它把 gauge.json＋pre-registration.md 整理成一頁：條件與各組、每題兩組共用的指令與材料、四類檢查項、觸發題、成本估算（含停案時最少花多少）、可說明／無法說明、核可前自檢（引擎判得了的自動打勾，判不了的五條列給人勾）。
帶使用者看這一頁，只講三件事：題目是不是他的翻車、對照組拿到的指令有沒有洩題、可說明／無法說明他同不同意；然後問：「這份預先登錄可以嗎？可以我才鎖定並開跑；改了要重出核可頁、重新核可。」
使用者說可以之前，**不開跑、不寫任何結論**。核可對象是檔案不是頁面：說可以之後執行
```
node <SKILL_DIR>/scripts/gauge.mjs lock --config gauge/<dir>/gauge.json
```
（鎖住預先登錄、gauge.json、題目、材料、skill 的雜湊；之後任何一樣改了，引擎會拒跑。要改就重出核可頁、重新核可、`--relock`。）
環境裡有可視化 skill（例如 viz-explain、artifact-design）的話，可以再把核可頁的內容做成一頁互動說明給人看——選配，不取代檔案。`preview` 出不來時退回把 pre-registration.md 全文印出。
```

Add to 第 2 步 (after the `results.md` bullet):

```
- 語言：**執行檔用英文**——pre-registration.md（除了「可說明／無法說明」那一段用使用者的語言，因為結果會逐字引用）、gauge.json 的 note／id／slug、壓力題的 rule 與 pressures、觸發題的說明。**題目指令與材料維持真實任務的語言**：它們是受測刺激，使用者平常怎麼下指令就怎麼寫，不翻譯。檢查項的 `text` 是給評分者的判斷句，用英文；同一條再給一句使用者語言的 `label`（核可頁與報告顯示 label，評分只讀 text）。給人看的東西——核可頁、報告、你在對話裡說的話——用使用者的語言。
```

Also update the `gauge.json` field list in SKILL.md: `assertions[{id, family, text, label(可選), cases[]}]`. Update 第 4 步 cost sentence to say the approval page already shows the estimate（「核可頁已算過；照它報」）.

## 4. Tests

selftest.mjs (append; keep the existing style):
- `mdToHtml`: heading → `<h2>`, list → `<li>`, table → `<table>`, `<script>` in input is escaped, never throws on garbage input.
- `renderPreviewHtml(minimalData)`: contains 題組, 成本估算, 核可前自檢, the case id, escaped prompt (`&lt;script&gt;`), and no external `http` resource.
- `buildPreview` cost math against a hand-computed example (e.g. 5 cases × 3 arms × 2 runs, trigger 8+8×2, matrix 2 cells → executions 30, gradings 30, isolation 4, selfcheck 2, trigger 32, totalCalls (30+30+4+2)×2 + 32×2 = 196).
- label display: report render with an assertion carrying `label` shows the label text.

e2e-stub.mjs (insert right after the lock block, before `all`):
- `preview --config CFG --out <work>/preview-before.html` on a fresh copy without lock → exit 0, file exists, contains 未鎖定 and meeting-notes and 成本估算.
- after lock: `preview --config CFG --out <work>/preview.html` → contains 已鎖定.
- (optional) modify a prompt file copy → mismatch shown; restore.

Run `node …/selftest.mjs` and `node …/e2e-stub.mjs` and put the real counts into `docs/testing.md`.

## 5. Acceptance criteria

- AC1 `node scripts/gauge.mjs preview --config exercises/fixtures/meeting-notes/gauge/gauge.json --out /tmp/x.html` exits 0 without `claude` on PATH (test with `PATH=/usr/bin:/bin`) and writes a self-contained HTML (no `http://`, no `https://` except inside user text).
- AC2 The page shows every case's shared prompt verbatim and every material's head; nothing is invented.
- AC3 Lock state is right in all three states (none / locked / mismatch).
- AC4 selftest and e2e-stub pass with the new tests; the previous tests are untouched and still pass.
- AC5 `report.html` still renders unchanged for reports without `label`; with `label` it shows the label.
- AC6 SKILL.md Step 3 no longer instructs printing pre-registration.md in full as the primary path.
- AC7 Nothing under `templates/`, `examples/`, `exercises/01-*` changed; `git diff --stat` shows only the files listed above.

Commit on this branch with a message in the repo's style (Chinese, `feat(engine): 核可頁 preview …`), one commit is fine. Do not merge, do not push.
