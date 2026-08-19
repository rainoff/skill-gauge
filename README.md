# skill-gauge — 你寫的 skill 有沒有用，測量過才知道

寫完 skill、讓 AI 用了幾天，感覺有時候有幫忙、有時候又沒有。只靠使用體驗，分不出三種狀況：**沒用**（模型本來就會）、**幫倒忙**（把原本做得好的改壞）、**今天有用、換個模型就多餘**。這個 repo 是一套測量方法加一支測量引擎：同一題讓 AI 帶著 skill 執行一次、不帶再執行一次，在隔離的環境裡、用寫死的標準、盲評，最後告訴你差幾格、穩不穩、可以說什麼、不能說什麼。

方法可以照抄，題目要你自己出，結論只在你自己的條件上成立。

## 三步開始（Claude Code）

```zsh
git clone git@github.com:rainoff/skill-gauge.git && cd skill-gauge && claude
```

然後對 AI 說一句：**「用 skill-gauge 幫我測量 ○○ skill」**（○○ 是一個含 `SKILL.md` 的資料夾）。接下來會發生的事：

1. **它問你六題。** 最重要的一題是「這個 skill 讓你翻車過哪兩次」——題目只從你真實遇過的事來，不抄別人的。沒翻車過也可以，它改用 skill 自己宣稱會做到的事出題，並寫進條件表。
2. **它出一頁核可頁，然後停下來等你說「可以」。** 頁上有題目、檢查項、這次測量可說明／無法說明什麼、成本估算。你只要看三件事：題目是不是你的翻車、對照組拿到的指令有沒有洩題、可說明／無法說明你同不同意。你說可以，它才鎖住這些輸入——之後改了任何一項，引擎會拒絕執行。
3. **它先報成本，你點頭才執行。** 引擎開跑前先做已知答案檢查，證明沙盒環境真的關上了門；再**先執行不帶 skill 那一組**，每條檢查每次都過就停（這組題測不出 skill 的貢獻：模型本來就會，或題目太鬆）；沒全過才執行帶 skill 那組。每份產出交給另一個新對話盲評，評分者先用已知好壞各一份驗過自己。
4. **報告第一頁是給人看的：** 有沒有幫上忙、優點在哪、缺點在哪、這次的限制、該怎麼改；工程細節（差幾格、改幾個判定會反轉、哪些檢查兩組全過測不出差別、成本、每一份產出全文與評分證據）放在後面。`report.md` 與 `report.html` 是同一份資料，網頁版多一段「逐份看產出」。

**Windows** 請在第 3 步的引擎指令加 `--root D:\sg`（系統暫存目錄在使用者目錄底下，引擎會拒跑；原因見[細節版](docs/how-it-runs.md)）。**要多久：** 08-18 測 clarify（5 題 × 3 次 × 4 組＋觸發題 30 次）約 54 分鐘；先 `--runs 1` 看看，教具（下面）三組約 9 分鐘。前提：`claude --version` 有回應、Node ≥ 18。

## 它是怎麼測的（一分鐘版）

| 做法 | 防的是什麼 |
|---|---|
| 題目從你的翻車經驗來；沒有就從 skill 的宣稱來 | 題目出在自己順手的地方，測出來當然好看 |
| 題目、檢查項、可說明／無法說明，開跑前寫死並鎖住；改了就不讓執行 | 看完結果再挑標準 |
| 沙盒環境：主目錄之外的空資料夾、只放受測 skill、關掉全域規則／工具／自動記憶；開跑前用已知答案檢查證明門真的關了 | 你平常的環境混進兩組，換台電腦結果就對不起來 |
| 先執行不帶 skill 那組，全過就停 | 花錢測一組模型本來就會的題 |
| 第三組「只給一句提醒」 | 分不出是 skill 的內容有用，還是「有被提醒」就有用 |
| 盲評：評分的 AI 不知道手上這份是哪一組；評分者先用已知好壞各一份驗過自己 | AI 評 AI，尺沒先驗過 |
| 只講差幾格、改幾個判定會反轉；不替你判「差幾格才算差」 | 把浮動讀成 skill 的效果 |
| 結論綁條件：模型、環境、任務型態、使用者能力任一項換了就要重測 | 拿一次結果外推 |

同一份鎖住的題目上還能多做四件事：**壓力測試**（老闆催、加班、「這次先這樣」，看 skill 定的規則守不守得住，藉口逐句留檔）、**換模型或 effort 再測**（`matrix`：對誰是稅、對誰有幫助）、**description 優化**（`describe`：觸發率低時，只動 description，held-out 選最佳，預設不寫回）、**改版後比較**（`compare`：逐條 held／regressed／improved）。指令都在 [SKILL.md](.claude/skills/skill-gauge/SKILL.md) 第 4 步。

## 裡面有什麼

| 東西 | 在哪 | 用途 |
|---|---|---|
| **模板三份** | [templates/](templates/) | 出題單（`case.md`）、開跑前寫死單（`pre-registration.md`）、結果報告（`results.md`）——照著填就好 |
| **實測範例** | [examples/viz-explain-v2/](examples/viz-explain-v2/) | 一次真實測量的全鏈：預先登錄 → 執行 → 結果。**這一次量到的是變因不是效果**，結果對作者自己不利，每一條原因照實留著——誠實的報告長什麼樣，就是這份 |
| **練習一題** | [exercises/01-meeting-notes-skill.md](exercises/01-meeting-notes-skill.md) | 紙上為一個虛構 skill 設計測量，不用執行程式 |
| **教具** | [exercises/fixtures/meeting-notes/](exercises/fixtures/meeting-notes/) | 一個十行的會議記錄 skill＋一套能直接執行的 `gauge.json`（含壓力題、16 題觸發題、兩格矩陣）。想先看引擎長什麼樣：`cd` 進去跑 `node ../../../scripts/gauge.mjs all --config gauge/gauge.json --out /tmp/sg-demo --runs 1`；不想花錢，`GAUGE_CLAUDE_CMD="node <repo>/.claude/skills/skill-gauge/scripts/stub-claude.mjs"` 用假模型走一遍看檔案長什麼樣 |

要在別的專案裡用，三種裝法擇一：(a) clone 這個 repo、在裡面開 `claude`（project skill）；(b) 把 `.claude/skills/skill-gauge/` 整個資料夾複製到你的 `~/.claude/skills/`（引擎跟著走）；(c) 當 plugin 裝：`claude plugin marketplace add rainoff/skill-gauge`（repo 還是 private 時用本機路徑 `claude plugin marketplace add ./skill-gauge`）→ `claude plugin install skill-gauge@skill-gauge`（08-18 mac 實測：裝完 `claude plugin details` 列出 Skills (1) skill-gauge，常駐約 380 token）。

## 沒有 Claude Code 的人

用 Cowork／Claude Desktop／Claude.ai：把 `.claude/skills/skill-gauge/SKILL.md` 和 `templates/` 三份檔的內容貼給你的 AI，說同一句話。它能帶你做完問答與預先登錄；兩組要靠你自己開新對話執行，做法與隔離做得到哪一級，見[細節版「不用 Claude Code 的同事怎麼跑」](docs/how-it-runs.md#不用-claude-code-的同事怎麼跑coworkclaude-desktopclaudeai)。

## 這一版做不到的（誠實邊界）

- 兩組**順序不隨機**：預設先執行不帶 skill 那組（全過就停、省一半錢），要同時段就加 `--interleave`；隨機交錯排下一版。
- 拒做或沒交付的那一次只作廢、不進分數（會標旗、寫進限制段）。
- 沒有人工標準答案、沒算誤差範圍、沒告訴你該執行幾次；沒放已知的錯進去驗評分。所以它只能說「在這次條件下差幾格、穩不穩」，不能說「放進 skill 造成了差」。
- 維護者只在 Claude Code 上實跑過；Cowork／Desktop 兩列來自官方說明書。引擎在 Windows 的實跑紀錄、每次改版跑了什麼測試、還沒測到什麼，見 [docs/testing.md](docs/testing.md)。MCP 沒有設已知答案題，不在已驗範圍。
- 還沒有的、排下一版的，見 [roadmap](docs/roadmap.md)。

## 想確認引擎沒騙你

引擎自動做的五步（隔離目錄、三個開關、已知答案檢查、兩組執行、盲評）手動怎麼照抄、方法骨架從哪裡來、哪些設計吸收自 [skill-forge](https://github.com/neokn/skill-forge)（作者 Jrting Shiau）——都在 [docs/how-it-runs.md](docs/how-it-runs.md)。

## 一句話帶走

**多測量幾次只能平衡浮動，救不了偏差**——像體重計沒有歸零，站一百次都是錯的，數字還是很好看。所以功夫花在設計上：對照組、鎖住、沙盒環境、盲評，一個一個把偏差設計掉；設計不掉的，誠實標在結果旁邊。

## License

[MIT](LICENSE)
