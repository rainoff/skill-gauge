# skill-gauge

> 量測 AI skill 到底有沒有用的一套方法模板。gauge＝量規。
>
> **這是 v0**：只放三件——量測模板、一個完整的實測範例、一題練習。其餘見 [roadmap](docs/roadmap.md)。

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

## 怎麼跑一次量測（Claude Code）

前提：Claude Code 已安裝並登入（`claude --version` 有回應）。跑法只有三件事：**隔離目錄、三個開關、先做已知答案檢查**。

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
