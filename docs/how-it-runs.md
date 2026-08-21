# 細節版：手動照抄的跑法、方法骨架、致意

> 這一頁是 [README](../README.md) 的細節版：引擎自動做的事、手動怎麼照抄、沒有 Claude Code 的人怎麼跑、方法從哪裡來。README 讀完想確認「引擎沒騙我」再來這裡。本頁與 README 說的「沙盒環境」＝主目錄之外的暫存目錄＋三個啟動開關（隔的是你的規則、記憶、工具），不是作業系統層的安全沙箱。

## 怎麼跑一次量測（Claude Code）——引擎自動做的事，手動也能照抄

README「三步開始」裡的引擎（`.claude/skills/skill-gauge/scripts/gauge.mjs`）做的就是下面這五步。想自己動手、或想確認引擎沒騙你，照抄即可。前提：Claude Code 已安裝並登入（`claude --version` 有回應）。跑法只有三件事：**隔離目錄、三個開關、先做已知答案檢查**。

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

同一個目錄、同一句問句，只差有沒有那三個開關。**不帶要讀得到，帶了要讀不到**——只有「讀不到」沒有對照，證明不了是開關的功勞（可能只是換了目錄）。問句換成你自己知道答案的一條：某條全域規則、某個全域 skill 的名字、你的記憶索引（手動照抄時可換；引擎自動做的那次是固定題：全域規則對回應語言的要求＋受測 skill 的名字）。

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

產出交給另一個全新 session 評分（判時不告知是哪一臂），照 pre-registration 的斷言表逐條二元判定；填完 results 的數據欄才寫結論，措辭受「可說明／無法說明」約束。

**已驗範圍（照抄進 results 的條件宣告）**：2026-08-17 在 macOS 與 Windows 各一台，對「一條全域規則、自動記憶索引、一個全域 skill、一個全域 hook」的已知答案檢查，這套做法都得到預期結果（每題各跑一次）。MCP 沒有設檢查題，不在已驗範圍。

## 不用 Claude Code 的同事怎麼跑（Cowork／Claude Desktop／Claude.ai）

方法一樣——出題、判準、兩臂、條件表、可說明／無法說明全部照模板；差的只有執行。分級照官方 skill-creator 說明書自己的寫法（Claude Code 內建 `/skill-creator` 的 SKILL.md 文末「Claude.ai-specific instructions」與「Cowork-Specific Instructions」兩節）：

| 你用的工具 | 兩臂怎麼跑 | 隔離做到哪 | 條件表「harness」欄怎麼填 |
|-----------|-----------|-----------|------------------------|
| Claude Code | 「怎麼跑一次量測」全套 | 三個開關＋已知答案檢查 | 沙盒環境；把「已驗範圍」那段抄進去 |
| Cowork | 官方：有分身，可同一題兩組同時派出去跑、跑對照臂、評分；看結果用靜態報告 | 沒有那三個開關的對應物。做得到的：每個 run 開新對話；對照臂把受測 skill 關掉或移除；有記憶功能就關掉 | 「部分隔離」＋列出關了什麼、關不掉什麼 |
| Claude Desktop／Claude.ai | 官方：沒有分身，一次一題自己跑，官方明文跳過基準對照。要兩臂就靠人工：開兩個新對話、一個開 skill 一個關，各跑 N 次（N 先寫死），人工照斷言表逐條判 | 同上 | 同上，另加「評分＝人工」 |

三條不因工具而變：

1. **已知答案檢查照樣做**：新對話裡問「你現在能用的 skill 有哪些？有沒有 ○○？」——受測臂要答有、對照臂要答沒有；有記憶功能的再問一句你上次講過的事，對照臂要答不知道。讀得到的沒關掉，就不算隔離。
2. **對照臂關不掉 skill → 量到的是上界**（skill 在清單上但沒被指示使用），照 pre-registration 執行規則第 3 條寫進限制段。
3. **結論綁工具**：Claude Code 上量的數字一個字都不能搬去講 Desktop，反過來也一樣——工具跟模型一樣是條件表的欄位。

誠實標註：這個 repo 的維護者只在 Claude Code 上實跑過。Cowork／Desktop 兩列來自官方說明書的分級與方法本身，**沒有在那兩個工具上實跑過**；你跑了，把條件表跟卡點開 issue 回報。

## 方法骨架（六件）

來自維護者自家 harness 評測系統的實證做法：

1. **預先登錄（pre-registration）**：判準與「可說明／無法說明」先寫定、先 commit，跑完不得回改；要改開新版。防的是「先看結果再挑判準」。
2. **四族斷言（assertions）**：前置檢查（gate，不進分）／事實檢查／判斷檢查／取向觀察（不進分、強制留存）。防的是拿「模型本來就會的事」灌分。
3. **Baseline 對照＋負向對照**：先確認不帶 skill 時做不到或做不穩，效果才可歸因；再用「不該觸發的鄰近場景」量誤觸發。兩欄在本 repo 的模板中為**必備欄位**。
4. **Pass 判準四分類**：結果／流程／風格／效率，設計判準時逐類問「這類要不要測」。只測結果會漏掉「答案對但路徑投機」。
5. **乾淨對照題**：材料完整正確的題，量「會不會把好的改壞」——只出陷阱題量不到這件事。
6. **friction→case 管線**：題目從真實摩擦來——某次 skill 沒觸發、某次產出做錯，一條摩擦一個題。

## 致意與界線

三件設計吸收自 [skill-forge](https://github.com/neokn/skill-forge)（作者 Jrting Shiau），以自家語彙重新表述：

- **反例題工具化**——不該觸發的場景做成每次必跑的測試（本 repo 的負向對照欄）
- **壓力測試位**——模擬時限壓力、上級說跳過的場景，藉口逐字留檔（pre-registration 模板的壓力測試位）
- **隔離的誠實**——量測條件與樂觀偏差寫在結果旁，不藏（results 模板的條件宣告與限制段）

量測隔離的操作化（暫存目錄的隔離環境＋`--setting-sources project --strict-mcp-config`）同樣採 skill-forge cli-executor 的做法；**兩處補正**來自 2026-08-17 兩台機器的已知答案探針：隔離目錄不得位於主目錄底下（上層目錄的 `.claude/rules` 會被當 project rules 載入），且要另加 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`（那兩支旗標管不到自動記憶）。指令見本頁「怎麼跑一次量測」；規則條文見 [pre-registration 模板的執行規則](../templates/pre-registration.md)。

skill-forge 的 Iron Law 措辭、Tier 0–3 命名、九步鍛造流程**不搬**——那是鍛造流程的東西，本 repo 只管量測。注意兩邊的「Tier／層」講的不是同一件事：skill-forge 的 Tier 量 skill 工件的證據成本，與本 repo 無對應。

