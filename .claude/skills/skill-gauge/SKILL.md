---
name: skill-gauge
description: 幫使用者量測一個 AI skill 到底有沒有用（skill-gauge 方法，v1.2）。流程＝問答收集翻車案例與量測條件 → 生出題目、預先登錄、gauge.json → 停下來等使用者核可 → 用引擎自動跑兩組（帶 skill／不帶）、盲評、出報告（report.md＋report.html）→ 照「可說明／無法說明」寫結果；也能量壓力測試（規則在壓力下守不守得住）、多模型×effort 矩陣、觸發率與描述優化（只動 description、held-out 選最佳）、回歸比較。使用者說「幫我量／測 ○○ skill」「這個 skill 有沒有用／有沒有在做事」「用 skill-gauge」「skill eval／評測／benchmark」「量一下這個 skill」「這個 skill 換模型還有用嗎」「壓力測試這個 skill」「幫我測 description 觸發」時使用；使用者只是要寫或修 skill 的內容、或一般聊天時不要用。
---

# skill-gauge — 幫使用者量一個 skill（v1.2）

你做的是量測設計與執行的苦工；判斷留給人。文末四個停止點不可省——省了，量出來的東西比不測還糟。
引擎在本 skill 資料夾的 `scripts/gauge.mjs`（Node ≥ 18，零依賴；mac／Linux 實跑過，Windows 有對應處理但實跑紀錄以 docs/testing.md 為準）。以下用 `<SKILL_DIR>` 代表本 skill 資料夾（Claude Code 會把 `${CLAUDE_SKILL_DIR}` 換成這個路徑；用 plugin 安裝的也一樣——看不到替換就用你讀到這份 SKILL.md 的資料夾）。

## 第 0 步：確認前提（半分鐘）

- 找模板：repo 根目錄 `templates/`（pre-registration／case／results）。找不到（本 skill 被複製到別處）就用文末「精簡欄位表」，並告訴使用者。
- 找受測 skill：要一個**含 SKILL.md 的資料夾路徑**。記名稱、版本快照（commit 或日期）。
- **認受測物的型態**（v1 只量 skill 資料夾）：往上層找 `.claude-plugin/plugin.json`（隸屬外掛）、看內文有沒有引用 `mcp__` 工具或依賴 hook——有任一項就先直說：隔離環境只複製 skill 資料夾，外掛的 hook／MCP 不隨行，兩組一起缺，效果會低估甚至趨同。使用者仍要量就繼續；引擎會自動偵測、把這件事寫進報告【邊界】（帶這類設定的停案結論會加低估警語），你在 results 的限制段照抄。
- **還沒寫 skill、只是想知道該不該寫？** 一樣走六問（翻車案例照給），gauge.json 不填 skill，第 4 步改跑 `baseline`：只量不帶 skill 的模型做不做得到、穩不穩。答案是「不用寫」或「值得寫，而且知道要補哪幾條」——這是 skill-forge「先確認不帶 skill 真的過不了」那條鐵律，我們把它做成量測的前段。
- 你可以讀受測 skill：用來理解它做什麼、抄下它**宣稱會做到的事**（第 2 步的第二來源）；**不把它規定的格式當計分項**——格式類照抄進評分，兩組會全過、分不出差別（這套方法第一版就是這樣死的），那些放前置檢查。
- 執行環境：`claude --version` 有回應＋`node --version` ≥ 18 才能自動跑；沒有的話走第 4 步的手動路。

## 第 1 步：問答（一次問完六題；沒答的欄位標「未填」，不代填）

1. 這個 skill 平常用在什麼任務？一句話。
2. 用它的時候，哪一兩次讓你不安或翻車？具體發生什麼、回頭查發現什麼？——**最好的題目來源**。沒有翻車過、只想知道它有沒有在做事？照答「沒有」，題目改從第 2 步的第二、三來源出，並在條件表寫明。
3. 它是哪一型：產出物型（檔案或頁面）／方法注入型（改變做事方式）／互動型（一場對話）？不確定就由你判斷、說理由，請使用者確認。
4. 條件四格：執行、評分各用哪個模型（給不出就用預設 `claude-sonnet-5` 執行、`claude-opus-5` 評分）？在哪個工具跑？題目覆蓋哪些任務型態？誰在用（新手／資深）？
5. 沒有這個 skill 時，你會怎麼下指令做同一件事？——兩組共用的指令從這裡來，**不從 skill 抄**。
6. 你希望結果回答什麼？（值不值得維護／該不該推給同事）
7. （可選）要不要加第三組「一句提醒」：只給一行「請仔細照指示做，不確定的標出來」的極簡 skill，或同長度同格式、內容中性的說明書。回答的是「是 500 行高明，還是一句提醒就值回全部」——把「有被指示」和「指示的內容」拆開。成本多一組。使用者要就在 gauge.json 的 `arms` 加 `{"name":"reminder","skillPath":"…/reminder"}`（第三組的 SKILL.md 由你生成、放在 gauge 目錄下、跟著 lock），報告會多一行「內容比提醒多貢獻幾格」。

## 第 1.5 步：使用情境訪談（出題之前，不可跳過）

六問問的是「這個 skill 是什麼」；這一步問的是「它該在哪些場合跑得通」。順序固定，不要跳著做：

1. **先自己研究 skill 本體**——讀完 SKILL.md 與它附的檔案，抄下它宣稱會做到的事、它預設的使用場合。自己讀得出來的別拿去問，問了只會消耗使用者的耐心。
2. **只針對模糊處訪談 skill 的擁有者**——三個問題：希望它在哪些場景跑得通？哪些場景你自己也不確定？每個場景「做對了」長什麼樣（一條一條講，不要只說「做得好」）。
3. **產出兩份清單請使用者確認**：目標場景清單（一個場景一句話，之後對應一題）、每個場景的預期檢查清單（那一題要成立的每一件事）。
4. 兩份清單確認之後，才進第 2 步出題；出完照第 3 步核可、鎖定。

**為什麼要有這一步**：報告的主數字是「場景全對率」——一次執行要把那一題**全部**預期檢查（前置／事實／判斷／取向）都做對，才算一次成功。清單沒問清楚，量出來的成功率就不是使用者要的那個成功。反過來，全對制也會逼出出題紀律：**不是每次都該成立的預期，就不要寫進那一題的檢查清單**——一條可有可無的檢查會把整題的成功率拖垮。想觀察但不該當成敗判準的東西，就別列進去；要診斷哪個環節出問題，報告的「環節效益表」本來就會逐條拆給你看。

## 第 2 步：生檔（預設放 `gauge/<skill名>-<YYYYMMDD>/`）

- 題目：每題一個 `case-NN-<slug>.prompt.md`（**兩組逐字相同的指令**）＋材料檔放 `materials/`。至少三題：**陷阱題**（陷阱寫在 gauge.json 的 note 給人看，不進指令）；**乾淨對照題**（完整無陷阱的材料，量「會不會把好的改壞」）；**負向對照題**（不該觸發的鄰近場景）。
- **壓力測試**（受測 skill 是「守起來有代價的規則」——例如「沒說的期限不能補」「先寫測試」——就要加）：`type: pressure` 的題，gauge.json 多填 `rule`（一句話寫規則）、`pressures`（疊加 3 種以上：時間、權威、沉沒成本、疲勞、社會、一次性、範圍太小、似是而非的適用……）、`expectedBehavior`（`comply`＝該守住；`exempt`＝規則其實不適用、該正確不套用——每個定了規則的 skill 至少配一題 exempt，防止越修越死板）。指令要像真的：具體時間、真實檔名、「直接做決定並動手」；引擎會自動加「這是真實情境，你必須選擇並動手」的前言，並自動加一條「守住規則」的判斷檢查項。評分者回四種判定之一：守住（held）／順著壓力違反（violated）／硬套規則（overapplied，exempt 題）／拒做或沒交付（refused：沒違反規則、但也沒把正當工作做完，只講道理或反問）——極性不對的判定引擎會歸類或作 inconclusive；合理化說詞逐字擷取到 `pressure-capture.json`（每句會回產出裡驗證是不是真的原句），這份東西是交給建 skill 工具的原料。
- **觸發題**（`trigger.should`／`shouldNot`）：只想看「有沒有被叫起來」給各 2–4 題就夠；要跑描述優化就各給 8–10 題、要像真人會打的（有檔名、有情境、有口語，不該觸發的要是鄰近的近似題，不要拿明顯無關的湊數）。
- 題目與檢查項的來源，照優先序：①使用者的翻車案例（最有鑑別力）；②**skill 自己的宣稱**——description 與 SKILL.md 說它會做到什麼，逐字引用，量「宣稱有沒有兌現」（這是最不武斷的標準；沒翻車案例時的主來源）；③這類任務常見的失手（例：整理類會捏造事實、漏項；轉寫類會改數字）——由你提出、使用者確認，標「推測題」。**不准的只有兩件**：把 skill 規定的格式當計分項（那是前置檢查，兩組都要做得到）；對照組指令裡出現 skill 的核心指令詞。
- **只想看它有沒有在做事（沒有翻車案例）**：一定加觸發測試（`trigger.should` 從 description 出、`shouldNot` 出鄰近的不該觸發）；報告會給三個數：觸發率、帶 skill 那組真的載入 skill 的次數、兩組產出相似度（接近同組內＝沒改變產出）。這回答「有沒有在做事」；「有沒有價值」仍看計分差距與停案規則，條件表「任務分佈」寫「題目來自 skill 宣稱，不是真實翻車」。
- `pre-registration.md`：照模板填。條件四格、受測物、兩組定義（帶 skill 那組多的只有 `.claude/skills/<name>/`）、題組表、四類檢查項、規模（每組至少 3 次，寫死）、**可說明／無法說明現在寫死**。對照組誠實檢查：共用指令不含 skill 的核心指令詞；含了就在限制段寫「量到的是剩下的那一點差別」。
- `gauge.json`（引擎讀的，欄位見下）。**前置檢查（gate）必須兩組都做得到**——例如「有整理成會議記錄」可以，「有三區結構」不行（那是 skill 教的格式，會讓不帶 skill 那組整批沒過前置檢查——那是有效但未成功的結果，不進計分，兩組因此不對等）。事實／判斷兩類每條要能二元判定、能指出證據；取向觀察不計分。
- `results.md`：只填條件宣告與限制段骨架，數據留空。
- 語言：**執行檔用英文**——pre-registration.md（照 `templates/pre-registration.md` 的段落結構寫，內容用英文；模板本身是使用者語言、給人讀的；「可說明／無法說明」那一段用使用者的語言，因為結果會逐字引用，標題保留「可說明／無法說明」讓核可頁抓得到）、gauge.json 的 note／id／slug、壓力題的 rule 與 pressures、觸發題的說明。**題目指令與材料維持真實任務的語言**：它們是受測刺激，使用者平常怎麼下指令就怎麼寫，不翻譯。檢查項的 `text` 是給評分者的判斷句，用英文；同一條再給一句使用者語言的 `label`（核可頁與報告顯示 label，評分只讀 text）。給人看的東西——核可頁、報告、你在對話裡說的話——用使用者的語言。

`gauge.json` 欄位（範例：`exercises/fixtures/meeting-notes/gauge/gauge.json`）：
```
name, skill{name, path}, executorModel, executorEffort(可選 low|medium|high|xhigh|max), judgeModel, runs, root(可 null),
cases[{id, type: trap|clean|negative|pressure, promptFile, materials[], assertions[ids], note,
       （pressure 專用）rule, pressures[], expectedBehavior: comply|exempt, expectedOption(可選)}],
assertions[{id, family: gate|fact|judgment|orientation, text, label(可選), cases[]}],
trigger{runs, should[…該觸發的指令], shouldNot[…不該觸發的鄰近指令]}   ← 可選
matrix[{executorModel, effort}]   ← 可選：多模型×effort 矩陣的格
arms[{name, skill:true|false} | {name, skillPath}]   ← 可選：第三組
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

## 第 4 步：跑（先報成本，再執行）

核可頁已算過；照它報——題數 × 組數 × 次數＝幾次執行＋同樣次數的評分、已知答案檢查、評分者自證、（有觸發測試才花的）觸發次數、矩陣格數，核可頁的「成本估算」都列好了，每次約 10 秒到幾分鐘（看 skill）。使用者說跑再跑。

- **Claude Code**：一行跑完（已知答案檢查 → **不帶 skill 那組先跑滿、盲評、套停案規則** → 帶 skill 那組 → 盲評 → 報告）：
  ```
  node <SKILL_DIR>/scripts/gauge.mjs all --config gauge/<dir>/gauge.json --out gauge/<dir>/runs/<YYYYMMDD-HHMM> [--with-trigger]
  ```
  **停案規則**（skill-forge 的「先確認不帶 skill 真的過不了」，這裡是量測前段）：不帶 skill 那組每條計分檢查每次都過 → 引擎停、不跑帶 skill 那組、報告寫 STOP——意思是這組題／這把尺測不出 skill 的貢獻：要嘛模型本來就會、要嘛題目太鬆。這時你的工作是跟使用者一起**改題**（更貼近真實翻車、更刁）或**停案**（skill 對這個模型沒必要），不是多跑幾次、也不是加 `--ignore-stop-rule` 硬跑。基準組資料不完整時引擎判 INCOMPLETE、不准停案：有前置作廢或失敗要先補跑；沒過前置檢查（gate-false）的 run 是有效但未成功的結果，不必補跑，但一樣不算「每次都過」——要嘛改題讓它過、要嘛就別停案。停案時壓力題與負向對照題的帶 skill 組**仍會跑**（安全探針）：停案說的是「skill 幫不上忙」，不代表它不會幫倒忙（拒答、硬套、誤觸發）。**代價要說**：先跑基準組、再跑帶 skill 組，兩組不同時段——服務更新或負載變化會混進差距；要嚴格對照就 `--interleave`（兩組交錯、不先停案），錢多花一半。
  Windows 加 `--root D:\sg`（系統暫存目錄在使用者目錄底下，引擎會拒絕）。分段跑用 `run` / `grade` / `report`；已跑過的 run 不重跑（可續跑），要補跑就刪掉該 run 目錄再跑；`--interleave` 改回兩組交錯、不先跑基準組。**不可用 subagent 代替引擎跑兩組**——subagent 繼承你的環境，不是隔離。
- **換模型或 effort 再量（矩陣）**：gauge.json 填 `matrix`（或 `--models a,b --efforts low,high`），一行跑完每一格（每格＝一次完整量測，含停案規則）：
  ```
  node <SKILL_DIR>/scripts/gauge.mjs matrix --config gauge/<dir>/gauge.json --out gauge/<dir>/runs/<YYYYMMDD-HHMM>-matrix [--with-trigger]
  ```
  成本＝格數 × 上面那個數。矩陣最有用的讀法是「A 模型停案、B 模型繼續」——這個 skill 對誰有幫助、對誰只是負擔。格與格之間不互相當基準；每格各自看差幾格、翻幾格反轉。
- **描述優化**（觸發率低時；只動 description、不動內容）：
  ```
  node <SKILL_DIR>/scripts/gauge.mjs describe --config gauge/<dir>/gauge.json --out gauge/<dir>/runs/<YYYYMMDD-HHMM>-describe [--rounds 3] [--runs 3]
  ```
  引擎把觸發題分 train／held-out（6:4）、量目前的 description、請一個新 session 依 train 的失敗提案改寫、再量，最多幾輪；**用 held-out 分數選最佳**（避免對 train 過擬合），預設**不寫回**——報告給你最佳描述與分數，使用者要才加 `--apply`（會備份 SKILL.md、只改 description；改完 lock 會不一致，要重新核可＋lock）。誠實邊界：held-out 只有幾題、而且**選擇本身用了 held-out**，所以最佳那輪的 held-out 分數偏樂觀；要當證據，換一組全新題目再跑一次 `trigger`。次數用奇數（3）避免平手（平手算有觸發）。
- 報告除了 `report.md` 還有 `report.html`（自含、可直接開；矩陣是 `matrix.html`、描述優化是 `describe.html`）；`html --out <dir>` 可重出。每次出報告會在 gauge 目錄追加一列 `history.jsonl`；`history --config …` 列出歷次。
- **Cowork／Desktop／Claude.ai**：跑不了引擎。照 README「不用 Claude Code 的同事怎麼跑」——你準備兩組的指令、材料與人工紀錄表，使用者自己開新對話跑，回填 results.md。

## 第 5 步：寫結果

先讀 `report.md` 開頭的**「決策摘要」**（結論／成功率／情境地圖／效果／穩度／成本／邊界，接著三行路線建議——改 skill／改用法／發掘；有第三組時多一行、有量測層問題時多一行「改題目」。**成功率是主敘事**：場景全對率＝該題全部預期檢查都做對才算一次成功；**【結論】那行也由它驅動**——全對次數差 ≥1 次就是方向，打平時才看成本；成本行已含每次全對的花費與一次到位 proxy）——**轉述給使用者只用決策摘要這幾句**，每一句照唸，含它自帶的原始計數與但書；**不另念 assertion id、格數、相似度這些工程欄位**，要深究的人自己往下看。下面的「原始摘要（深究用）」與「先看這裡」是工程細節，要逐份看產出與評分證據就開 `report.html`（「逐份看產出」那一段——先看產出再看數字，不要先信總分）。填 `results.md`：§1 條件表照 report 的「條件」段回填**實際**模型；§5 通過數、§6 成本照表；§7 灰區寫評分證據裡看到的模稜處；§10 天花板照 report 的旗標（零鑑別、帶 skill 反而較差、同格 run 高度相似、前置檢查沒過集中、壓力下折了／過度套用）；有壓力題就把 `pressure-capture.json` 的合理化說詞逐字附上。**結論措辭只能用 pre-registration 寫死的「可說明」句式**；每一句可說明都要帶差距與「翻幾格就反轉」。前置作廢（執行或評分失敗）的 run 沒補跑前，不寫總結句；沒過前置檢查的 run 不用補跑——那是有效但未成功的結果，成功率與成本照算。

## 第 6 步：下一步——把量出來的東西接回建 skill 的迴圈

報告尾巴的「下一步」是引擎由旗標推導的三岔路，你照著帶使用者走，不要自己另起結論：
- **改題**（零鑑別、前置檢查沒過集中且是檢查含 skill 格式、同格 run 高度相似）：改 gauge.json／材料 → 重新核可＋lock → 再量。
- **改 skill**（帶 skill 反而較差、壓力下折了或過度套用、觸發率低）：把失分格的評分證據（`runs/<題>/with/r*/grading.json` 的 evidence）與 `pressure-capture.json` 的合理化說詞連同 skill 交給使用者建 skill 的工具（skill-forge create-skill 或官方 skill-creator）去改；**你不改 skill 內容**（唯一例外是 description——那是觸發的唯一依據、屬量測範圍，`describe --apply` 才寫回）。改完用同一份鎖定的題目再跑一次，`node <SKILL_DIR>/scripts/gauge.mjs compare <舊 report.json> <新 report.json>`（或 `compare --config gauge.json` 自動拿 history 最近兩次同條件）看每條 held／regressed／improved——任何一條 regressed 都要單獨講，不能被總分平均掉。
- **停案或退役**（基準組全過）：先改題再量；改題後還是全過，就跟使用者說這個 skill 對這個模型沒必要。
模型更新、skill 改版都用同一招：舊 report 留著，再跑、再 compare（同模型、同 effort、同鎖定才可比；不同的話引擎會標「只能參考」）。要一次看好幾個模型就跑 `matrix`。

## 四個停止點（違反其一，整次量測標無效）

1. 題目來自翻車案例或 skill 自己的宣稱（逐字引用），不拿 skill 的格式規定當計分項。
2. pre-registration 未經使用者說「可以」並 lock，不開跑。
3. 兩組用引擎跑（隔離的新程序、同指令、只差 skill 在不在；沙箱只拿得到白名單環境變數）；不用 subagent。
4. 評分由引擎交給另一個新 session、不知道是哪組；你不自己打分。

## 精簡欄位表（找不到 `templates/` 時用）

- **case**：id／skill 版本快照／source（哪一次真實摩擦）／type｜Scenario（指令＋材料，兩組逐字相同）｜Baseline 對照（模型本來做不做得到）｜負向對照｜怎樣算通過（[結果][流程][風格][效率]）｜Run method｜Runs 表
- **pre-registration**：條件宣告（模型／harness／任務分佈／使用者既有能力）｜受測物（名稱＋版本、類型、預期效果的依據、兩組各拿到什麼＋誠實檢查）｜題組表｜四類檢查項｜規模（題×2×次，寫死）｜可說明／無法說明｜執行規則
- **results**：實際組態｜開跑前處置｜前置檢查｜條件完整性｜逐項通過數｜成本｜判斷標準的灰區｜取向觀察｜可說明／無法說明／限制｜天花板檢查｜下一版候選
