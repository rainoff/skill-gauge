# skill-gauge

> 量測 AI skill 到底有沒有用的一套方法模板。gauge＝量規。
>
> **現在是 v1.1**：一個 skill＋一支量測引擎（隔離兩組、盲評、停案規則、壓力測試、多模型×effort 矩陣、觸發率與描述優化、回歸比較；報告出 md＋html）、三份模板、一個完整的實測範例、一題練習。還沒有的見 [roadmap](docs/roadmap.md)。

## 最快的用法：交給你的 AI（v1.1）

這個 repo 本身就是一個 skill，還帶一支量測引擎。你不用自己填模板、不用自己開兩組跑：讓你的 AI 照著做，你只負責回答六個問題、看一眼預先登錄說「可以」，然後讀報告。

**用 Claude Code 的人**

```zsh
git clone git@github.com:rainoff/skill-gauge.git && cd skill-gauge && claude
```

然後說一句：「用 skill-gauge 幫我量 ○○ skill」（○○ 是一個含 SKILL.md 的資料夾）。接下來會發生的事：

1. 它問你六個問題——最重要的一題是「這個 skill 讓你翻車過哪兩次」，題目只從這裡來。
2. 它生出題目、預先登錄、`gauge.json`，出一頁核可頁（`preview.html`，把條件、題目、檢查項、成本整理成一頁，不用讀原始檔案）給你看，然後**停下來等你說「可以」**。你說可以，它才鎖定這些輸入。
3. 它先報成本（幾次執行、大約多久），你點頭才跑：引擎先做已知答案檢查確認隔離真的成立；再**先跑不帶 skill 那組**跑滿次數並盲評——每條檢查每次都過就停（這組題測不出 skill 的貢獻：模型本來就會、或題目太鬆，改題或停案，不是多跑幾次）；沒全過才跑帶 skill 那組。每一次都是家目錄以外的新目錄、只放受測 skill；每份產出交給另一個新對話盲評；最後出報告。
4. 報告有兩份：`report.md`（開頭是「摘要結論」——給人看的一頁：有沒有幫上忙、贏在哪輸在哪、這次的限制、下一步；再往下才是工程細節：差幾格、翻幾格就反轉、哪些檢查項測不出差別、成本）與 `report.html`（同一份資料的網頁版，多一段「逐份看產出」：每一次執行的產出全文、每條檢查的判定與證據引句，讓你先看產出再看數字）。它照預先登錄寫死的「能說／不能說」寫結果，不會替你把描述寫成因果。

再往下還有四件事，都是同一份鎖定的題目上多跑幾次引擎：

| 想知道 | 怎麼跑 | 報告 |
|---|---|---|
| 這條紀律在**壓力下**守不守得住（老闆催、加班、「這次先這樣」）？ | 題目加 `type: pressure`（規則、疊加的壓力、預期守住或預期不套用），跑法不變 | 報告多「壓力測試」一節：守住／違反／硬套／拒做四種判定；折了或拒做的每一次都把合理化說詞擷取到 `pressure-capture.json`（逐句回產出裡驗證是不是原句），交給建 skill 的工具去修 |
| 換**模型或 effort** 還有用嗎？對誰是稅、對誰有幫助？ | `matrix`（gauge.json 填 `matrix`，或 `--models a,b --efforts low,high`） | `matrix.md`／`matrix.html`：一列一格，各格自己的停案判定與差幾格；格與格不互相當基準 |
| 觸發率低——**description** 怎麼改？ | `describe`：觸發題分 train／held-out，量、提案、再量，最多幾輪，held-out 選最佳；**預設不寫回**，`--apply` 才寫（只動 description） | `describe.md`／`describe.html`：逐輪分數、最佳描述、逐題 |
| skill 改版或模型更新後**退步了沒**？ | `compare <舊 report.json> <新 report.json>`，或 `compare --config` 拿 `history.jsonl` 最近兩次同條件 | 逐條 held／regressed／improved，任何一條退步單獨講 |

要在別的專案裡用，三種裝法擇一：(a) clone 這個 repo、在裡面開 `claude`（project skill）；(b) 把 `.claude/skills/skill-gauge/` 整個資料夾複製到你的 `~/.claude/skills/`（引擎跟著走）；(c) 當 plugin 裝：`claude plugin marketplace add rainoff/skill-gauge`（repo 還是 private 時用本機路徑 `claude plugin marketplace add ./skill-gauge`）→ `claude plugin install skill-gauge@skill-gauge`（08-18 mac 實測：裝完 `claude plugin details` 列出 Skills (1) skill-gauge，常駐約 380 token）。引擎自己怎麼被測、每次改版跑了什麼、還沒測到什麼，見 [docs/testing.md](docs/testing.md)。教具：`exercises/fixtures/meeting-notes/` 是一個十行的會議記錄 skill＋一套跑得起來的 `gauge.json`（含壓力題、16 題觸發題、兩格矩陣），想先看引擎長什麼樣，`cd` 進去跑 `node ../../../../scripts/gauge.mjs all --config gauge/gauge.json --out /tmp/sg-demo --runs 1`；沒有 claude 或不想花錢，`GAUGE_CLAUDE_CMD="node <repo>/.claude/skills/skill-gauge/scripts/stub-claude.mjs"` 用假模型走一遍看檔案長什麼樣。

**用 Cowork／Claude Desktop／Claude.ai 的人**

把 `.claude/skills/skill-gauge/SKILL.md` 和 `templates/` 三份檔的內容貼給你的 AI，說同一句話。它能帶你做完問答與預先登錄；兩組要靠你自己開新對話跑，做法見下方「不用 Claude Code 的同事怎麼跑」。

**想先搞懂方法的人**：讀實測範例、做練習題（不用跑程式），見「快速開始」。

## 定位：方法可攜、題目自備、結論綁條件

skill 的效果不是一個孤立的數字，它取決於量測當下的四個條件：

| 條件 | 問的是 |
|------|--------|
| 模型 | 在哪個模型上量的？換模型結論不保證外推 |
| harness | 量測環境裡還載入了什麼（規則、記憶、其他工具）？ |
| 任務分佈 | 題目長什麼樣？題目之外的任務型態原理上量不到 |
| 使用者既有能力 | 使用者自己的紀律與習慣，效果等同一層看不見的 harness——同一個 skill 對資深與新手的邊際效果可能完全不同 |

所以這個 repo 給的是**方法**（模板照抄可用）；**題目要你自己出**（從你真實遇到的問題來，不是抄別人的題）；**結論只在你宣告的條件內成立**（每份量測結果必附條件宣告區塊，模板已內建）。

醫學研究裡同一種藥對不同族群要分開分析（次群組分析）——skill 量測是同一件事。

## 快速開始

1. 讀 [實測範例（反面教材）](examples/viz-explain-v2/)：一次真實量測的全鏈——預先登錄 → 執行 → 結果 → 這個結果能說與不能說的話。**這是一次「量到變因、而不是效果」的實測**：結果對 skill 作者自己不利，且每一條變因都被抓了出來、連同原因分析原樣呈現——誠實報告長什麼樣，正是方法的示範重點。
2. 拿 [templates/](templates/) 三份模板出你自己的題：
   - [pre-registration.md](templates/pre-registration.md)——開跑前先寫定判準與「能說／不能說」
   - [case.md](templates/case.md)——單一題目的格式（情境、對照、判準、重跑方式）
   - [results.md](templates/results.md)——跑完先填數據、再寫結論
3. 做 [練習題](exercises/01-meeting-notes-skill.md)：不用跑任何程式，用模板為一個虛構 skill 設計量測。
4. 要量你自己的 skill 時，照下面「[怎麼跑一次量測](#怎麼跑一次量測claude-code)」做——先做已知答案檢查，再開跑。

## 怎麼跑一次量測（Claude Code）——引擎自動做的事，手動也能照抄

上面「最快的用法」裡的引擎（`.claude/skills/skill-gauge/scripts/gauge.mjs`）做的就是下面這五步。想自己動手、或想確認引擎沒騙你，照抄即可。前提：Claude Code 已安裝並登入（`claude --version` 有回應）。跑法只有三件事：**隔離目錄、三個開關、先做已知答案檢查**。

### 1. 開隔離目錄——不能在使用者主目錄底下

原因：`--setting-sources project` 會把目錄**和它每一層上層目錄**裡的 `.claude/` 都當成 project 設定載入。目錄放在主目錄底下，你自己的 `~/.claude/rules` 就從上層漏進來，而且不會有任何錯誤訊息。

macOS／Linux（`$TMPDIR` 在 `/var/folders/…`，不在主目錄底下）：

```zsh
RUN="${TMPDIR%/}/sg-run-$(date +%H%M%S)"; mkdir -p "$RUN"; cd "$RUN"
d="$PWD"; while [ "$d" != "/" ]; do [ -e "$d/.claude" ] && echo "STOP: $d 有 .claude"; d="$(dirname "$d")"; done; echo "scan done: $PWD"
```

Windows PowerShell（**不要用 `$env:TEMP`**——它在 `C:\Users\你\` 底下）：

```powershell
$RUN = New-Item -ItemType Directory "D:\sg-run-$(Get-Date -Format HHmmss)"; Set-Location $RUN
$p = "$RUN"; while ($p) { if (Test-Path (Join-Path $p ".claude")) { "STOP: $p 有 .claude" }; $p = Split-Path $p -Parent }; "scan done: $RUN"
```

沒印出 `STOP` 才往下。

### 2. 先做已知答案檢查（第一次跑、換機器、升版本都要做）

同一個目錄、同一句問句，只差有沒有那三個開關。**不帶要讀得到，帶了要讀不到**——只有「讀不到」沒有對照，證明不了是開關的功勞（可能只是換了目錄）。問句換成你自己知道答案的一條：某條全域規則、某個全域 skill 的名字、你的記憶索引。

```zsh
Q="你載入的全域行為規則對回應語言有什麼要求？若沒有任何全域規則被載入，只回答 NO-RULES"
claude -p "$Q"                                                                                    # 應答出你自己的某條規則
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p "$Q" --setting-sources project --strict-mcp-config   # 應答 NO-RULES
```

```powershell
$Q = "你載入的全域行為規則對回應語言有什麼要求？若沒有任何全域規則被載入，只回答 NO-RULES"
$Q | claude -p                                                                                    # 應答出你自己的某條規則
$env:CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1"; $Q | claude -p --setting-sources project --strict-mcp-config   # 應答 NO-RULES
```

帶了開關還讀得到 → 先回第 1 步查上層目錄有沒有 `.claude/`，這是最常見的原因。

三個開關各管什麼：`--setting-sources project` 不載你的全域規則、全域 skill、全域 hook；`--strict-mcp-config` 不載你平常的 MCP 工具；`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 不載自動記憶——前兩個開關管不到它（官方記載的行為，不是 bug）。

### 3. 兩臂各一個目錄；帶 skill 的那臂把受測 skill 放進 project 層

```
sg-run-…/prompt.txt                                ← 題目（兩臂同一份，照 case.md 寫）
sg-run-…/with/.claude/skills/<你的skill>/SKILL.md   ← 受測 skill 複製進來
sg-run-…/without/                                  ← 什麼都不放
```

題目要用的材料兩個目錄各放一份、內容相同。

### 4. 執行：三個開關一起給，兩臂完全相同

```zsh
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
cd "$RUN/with";    claude -p --setting-sources project --strict-mcp-config < ../prompt.txt > ../with-1.md
cd "$RUN/without"; claude -p --setting-sources project --strict-mcp-config < ../prompt.txt > ../without-1.md
```

```powershell
$env:CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1"
Set-Location "$RUN\with";    Get-Content ..\prompt.txt -Raw | claude -p --setting-sources project --strict-mcp-config | Set-Content ..\with-1.md
Set-Location "$RUN\without"; Get-Content ..\prompt.txt -Raw | claude -p --setting-sources project --strict-mcp-config | Set-Content ..\without-1.md
```

每臂跑幾次在 pre-registration 先寫死；每次 `claude -p` 就是一個全新 session。

### 5. 評分與結論

產出交給另一個全新 session 評分（判時不告知是哪一臂），照 pre-registration 的斷言表逐條二元判定；填完 results 的數據欄才寫結論，措辭受「能說／不能說」約束。

**已驗範圍（照抄進 results 的條件宣告）**：2026-08-17 在 macOS 與 Windows 各一台，對「一條全域規則、自動記憶索引、一個全域 skill、一個全域 hook」的已知答案檢查，這套做法都得到預期結果（每題各跑一次）。MCP 沒有設檢查題，不在已驗範圍。

## 不用 Claude Code 的同事怎麼跑（Cowork／Claude Desktop／Claude.ai）

方法一樣——出題、判準、兩臂、條件表、能說／不能說全部照模板；差的只有執行。分級照官方 skill-creator 說明書自己的寫法（Claude Code 內建 `/skill-creator` 的 SKILL.md 文末「Claude.ai-specific instructions」與「Cowork-Specific Instructions」兩節）：

| 你用的工具 | 兩臂怎麼跑 | 隔離做到哪 | 條件表「harness」欄怎麼填 |
|-----------|-----------|-----------|------------------------|
| Claude Code | 上面那段全套 | 三個開關＋已知答案檢查 | 空房間；把「已驗範圍」那段抄進去 |
| Cowork | 官方：有分身，可同一題兩組同時派出去跑、跑對照臂、評分；看結果用靜態報告 | 沒有那三個開關的對應物。做得到的：每個 run 開新對話；對照臂把受測 skill 關掉或移除；有記憶功能就關掉 | 「部分隔離」＋列出關了什麼、關不掉什麼 |
| Claude Desktop／Claude.ai | 官方：沒有分身，一次一題自己跑，官方明文跳過基準對照。要兩臂就靠人工：開兩個新對話、一個開 skill 一個關，各跑 N 次（N 先寫死），人工照斷言表逐條判 | 同上 | 同上，另加「評分＝人工」 |

三條不因工具而變：

1. **已知答案檢查照樣做**：新對話裡問「你現在能用的 skill 有哪些？有沒有 ○○？」——受測臂要答有、對照臂要答沒有；有記憶功能的再問一句你上次講過的事，對照臂要答不知道。讀得到的沒關掉，就不算隔離。
2. **對照臂關不掉 skill → 量到的是上界**（skill 在清單上但沒被指示使用），照 pre-registration 執行紀律第 3 條寫進限制段。
3. **結論綁工具**：Claude Code 上量的數字一個字都不能搬去講 Desktop，反過來也一樣——工具跟模型一樣是條件表的欄位。

誠實標註：這個 repo 的維護者只在 Claude Code 上實跑過。Cowork／Desktop 兩列來自官方說明書的分級與方法本身，**沒有在那兩個工具上實跑過**；你跑了，把條件表跟卡點開 issue 回報。

## 方法骨架（六件）

來自維護者自家 harness 評測系統的實證做法：

1. **預先登錄（pre-registration）**：判準與「能說／不能說」先寫定、先 commit，跑完不得回改；要改開新版。防的是「先看結果再挑判準」。
2. **四族斷言（assertions）**：前置檢查（gate，不進分）／事實紀律／判斷紀律／取向觀察（不進分、強制留存）。防的是拿「模型本來就會的事」灌分。
3. **Baseline 對照＋負向對照**：先確認不帶 skill 時做不到或做不穩，效果才可歸因；再用「不該觸發的鄰近場景」量誤觸發。兩欄在本 repo 的模板中為**必備欄位**。
4. **Pass 判準四分類**：結果／流程／風格／效率，設計判準時逐類問「這類要不要測」。只測結果會漏掉「答案對但路徑投機」。
5. **乾淨對照題**：材料完整正確的題，量「會不會把好的改壞」——只出陷阱題量不到這件事。
6. **friction→case 管線**：題目從真實摩擦來——某次 skill 沒觸發、某次產出翻車，一條摩擦一個題。

## 致意與界線

三件設計吸收自 [skill-forge](https://github.com/neokn/skill-forge)（作者 Jrting Shiau），以自家語彙重新表述：

- **反例題工具化**——不該觸發的場景做成每次必跑的測試（本 repo 的負向對照欄）
- **壓力測試位**——模擬時限壓力、上級說跳過的場景，藉口逐字留檔（pre-registration 模板的壓力測試位）
- **隔離的誠實**——量測條件與樂觀偏差寫在結果旁，不藏（results 模板的條件宣告與限制段）

量測隔離的操作化（暫存目錄的隔離環境＋`--setting-sources project --strict-mcp-config`）同樣採 skill-forge cli-executor 的做法；**兩處補正**來自 2026-08-17 兩台機器的已知答案探針：隔離目錄不得位於主目錄底下（上層目錄的 `.claude/rules` 會被當 project rules 載入），且要另加 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`（那兩支旗標管不到自動記憶）。指令見上方「怎麼跑一次量測」；紀律條文見 [pre-registration 模板的執行紀律](templates/pre-registration.md)。

skill-forge 的 Iron Law 措辭、Tier 0–3 命名、九步鍛造流程**不搬**——那是鍛造流程的東西，本 repo 只管量測。注意兩邊的「Tier／層」講的不是同一件事：skill-forge 的 Tier 量 skill 工件的證據成本，與本 repo 無對應。

## 一句話帶走

**多測幾次救得了浮動，救不了偏差**——重複量測能收斂隨機變異（浮動：每次測的數字都不同，多測取平均就穩），但對系統性偏差（測速永遠連到離你最近的伺服器，數字天生比體驗漂亮），在偏差未建模、未校準、只是重複同一量測的前提下，重複只會讓錯的數字看起來更可信。哪些偏誤能用工程消除、哪些能用統計壓低、哪些只能誠實標註，見實測範例的限制段。

## License

[MIT](LICENSE)
