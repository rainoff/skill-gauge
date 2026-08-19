# Spec: 「摘要結論」 — the one-page, plain-language conclusion at the top of every report

Branch: `feat/preview-page` (on top of the approval page + `label`). Maintainer decision 2026-08-18 22:10 after reading the first real measurement (clarify): "沒人陪讀看不懂；非工程師會有壓力、不會想用". The current 「先看這裡」 is an engineer's log (ids, ratios, 翻幾格, 同組內相似度). The report must first answer four questions in plain language; everything else moves below.

## What to build

`plainSummary(report, cfg?)` → `{ helped, wins[], losses[], limits[], next[] , oneLine }` (pure function, exported, no LLM), rendered:
- `report.md`: new first section `## 摘要結論（給人看的一頁）` right after the title, before 「先看這裡」（which is renamed 「先看這裡（工程細節）」 or kept as-is under a `## 細節` heading）.
- `report.html`: new first card `摘要結論`, then the existing sections; the nav lists it first.

Rules for the text:
- **No assertion ids, no arm names as raw tokens** (`with`/`without` → 「帶 skill」「不帶」; third arms by their zh label: reminder → 「只給一句提醒」, others → 「另一個 skill（<name>）」).
- Assertions are named by `label` if present, else the first clause of `text` (cut at the first 「；」「，」「（」 or 24 chars) — never the id.
- Numbers: at most one headline number (差幾格／幾格會反轉) plus per-item 「N 次裡 M 次」 phrasing (never `2/3`-style fractions in prose; write 「3 次裡 2 次」).
- Sentences short; one idea per bullet; max 3 wins, 3 losses, 3 limits, 3 next steps.

### The four questions

1. **有沒有幫上忙？** — from `totals`/`sensitivity` (primary arms): 「帶 skill 過 A 格、不帶過 B 格（共 T 格）——多 D 格；翻 F 格就反過來」 + verdict word: D ≤ 2 → 「差不多」; 2 < D and F ≤ 3 → 「有一點差、不算穩」; F > 3 → 「有差」; D < 0 → 「帶 skill 反而差」. If baseline STOP → 「不帶 skill 就全過：這組題測不出 skill 的貢獻」. If confirmatory `primary.claimStatus` exists, prefix its level (確證句成立／確證口徑但分不出／描述性) — optional, only when the field is present.
2. **優點在哪、缺點在哪？**（舊名「贏在哪、輸在哪」，2026-08-19 改） — per assertion (scored only), compare with vs baseline pass counts:
   - wins: assertions where with > baseline, sorted by gap desc, top 3: 「<label>：不帶 N 次裡 M 次沒過，帶 skill 全過／N 次裡 M 次過」
   - losses: assertions where with < baseline (top 3) 「帶 skill 反而…」; plus 「兩組都全掛」 items (恆不過) as 「<label>：帶不帶都沒過——標準太嚴或規則不清，去看產出」; plus false triggers if `footprint.negativeFired > 0`: 「不該出手的題目 N 次裡 M 次 skill 還是被叫起來」; plus 「skill 沒真的被載入」 if fired < known.
   - if a third arm (reminder) exists: one line 「只給一句提醒那組過 R 格：skill 的內容比一句提醒多 X 格」 (from `placebo`).
3. **這次的限制** — 「只有 C 題、每題 K 次、執行模型 M、評分模型 J」; 「有 Z 條檢查兩組都全過（題太簡單，測不出差別）」 when Z > 0; 「翻 F 格就反轉，不要當定論」; 「作廢／失敗 N 次」 when any.
4. **下一步** — plain versions of `nextSteps` (map by prefix: 停案或退役／改題／改 skill／看作廢／加題不加次／改 skill（硬化規則）／改 skill（縮範圍）／拒做／改描述／保留這份報告當基準) — reuse the existing sentences but strip backticks/CLI names into parentheses at the end.

`oneLine` = the question-1 sentence (used by SKILL.md 第 5 步 as what to tell the user first).

## Where it lands

- `gauge.mjs`: `plainSummary()` after `buildReport` helpers; `report.summary = plainSummary(report, cfg)` inside `buildReport` (so `report.json` carries it); `reportMarkdown` prints it first; export for tests.
- `render.mjs`: `secSummary(r)` first in `renderReportHtml` (uses `r.summary`; if absent, render nothing — old reports keep working). Style: bigger line-height, the four questions as `<h3>`, bullets; no tables.
- `SKILL.md` 第 5 步: 「先讀『摘要結論』；轉述給使用者只用那一頁；工程細節在下面」.
- `README.md` step 4: report.md 開頭是「摘要結論」（一頁人話）.
- selftest: build a synthetic report (like the existing `sample`) with a `label`-less and a `label`-ed assertion, third arm, negative false-trigger, a 恆不過 item; assert: no assertion id string appears in the summary text; wins/losses picked correctly; the headline sentence has the right numbers; STOP case sentence; html contains 摘要結論 first.
- e2e: `report.md` starts with 摘要結論 and `report.html` has the card.

## Target text (hand-written from the real clarify report `gauge/clarify-20260818/runs/20260818-1921` — the generated version should read like this)

> **有沒有幫上忙？** 帶 skill 的 54 格裡過 50 格，不帶的過 45 格——多 5 格；翻 6 格就反過來，所以是「有一點差、不算穩」。
> **優點在哪**：不該重寫的時候不出手（不帶 3 次裡 2 次把清單改寫了，帶 skill 3 次都守住）；抽象英文詞翻白話（不帶 3 次裡 1 次沒翻，帶 skill 全翻）；不加料（不帶 3 次裡 1 次加了原文沒有的理由，帶 skill 都沒加）。
> **缺點在哪**：技術名詞保留英文原文——帶不帶都 3 次全沒過，去看產出；不該出手的題目 6 次裡 3 次 skill 還是被叫起來（該叫的時候 15 次裡 14 次有叫）；只給一句提醒那組過 41 格，比不帶還差——skill 的內容比一句提醒多 9 格。
> **這次的限制**：只有 5 題、每題 3 次、sonnet 執行、opus 評分；13 條檢查兩組都全過，題目對這個模型太簡單；翻 6 格就反轉，不要當定論。
> **下一步**：改題——把兩組都全過的那幾條換成模型會失手的情境，或刪掉那條檢查。

Version stays 1.1.1 (report gains a field). Commit on `feat/preview-page`; do not merge; do not push.
