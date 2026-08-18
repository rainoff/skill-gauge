---
name: skill-gauge
description: 幫使用者量測一個 AI skill 到底有沒有用（skill-gauge 方法，v1）。流程＝問答收集翻車案例與量測條件 → 生出題目、預先登錄、gauge.json → 停下來等使用者核可 → 用引擎自動跑兩組（帶 skill／不帶）、盲評、出報告 → 照「能說／不能說」寫結果。使用者說「幫我量／測 ○○ skill」「這個 skill 有沒有用」「用 skill-gauge」「skill eval／評測」「量一下這個 skill」時使用；使用者只是要寫或修 skill、或一般聊天時不要用。
---

# skill-gauge — 幫使用者量一個 skill（v1）

你做的是量測設計與執行的苦工；判斷留給人。文末四個停止點不可省——省了，量出來的東西比不測還糟。
引擎在本 skill 資料夾的 `scripts/gauge.mjs`（Node ≥ 18，零依賴，mac／Linux／Windows 通用）。以下用 `<SKILL_DIR>` 代表本 skill 資料夾。

## 第 0 步：確認前提（半分鐘）

- 找模板：repo 根目錄 `templates/`（pre-registration／case／results）。找不到（本 skill 被複製到別處）就用文末「精簡欄位表」，並告訴使用者。
- 找受測 skill：要一個**含 SKILL.md 的資料夾路徑**（v1 只量 skill 資料夾；外掛與帶 hook 的東西量不了隔離效果，直說並記進限制）。記名稱、版本快照（commit 或日期）。
- **還沒寫 skill、只是想知道該不該寫？** 一樣走六問（翻車案例照給），gauge.json 不填 skill，第 4 步改跑 `baseline`：只量不帶 skill 的模型做不做得到、穩不穩。答案是「不用寫」或「值得寫，而且知道要補哪幾條」——這是 skill-forge「先確認不帶 skill 真的過不了」那條鐵律，我們把它做成量測的前段。
- 你可以讀受測 skill，**只用來理解它做什麼；不從它的本文推題目與判斷標準**——判斷標準照抄 skill 本文，兩組會全過、分不出差別（這套方法第一版就是這樣死的）。
- 執行環境：`claude --version` 有回應＋`node --version` ≥ 18 才能自動跑；沒有的話走第 4 步的手動路。

## 第 1 步：問答（一次問完六題；沒答的欄位標「未填」，不代填）

1. 這個 skill 平常用在什麼任務？一句話。
2. 用它的時候，哪一兩次讓你不安或翻車？具體發生什麼、回頭查發現什麼？——**題目的唯一來源**。
3. 它是哪一型：產出物型（檔案或頁面）／方法注入型（改變做事方式）／互動型（一場對話）？不確定就由你判斷、說理由，請使用者確認。
4. 條件四格：執行、評分各用哪個模型（給不出就用預設 `claude-sonnet-5` 執行、`claude-opus-5` 評分）？在哪個工具跑？題目覆蓋哪些任務型態？誰在用（新手／資深）？
5. 沒有這個 skill 時，你會怎麼下指令做同一件事？——兩組共用的指令從這裡來，**不從 skill 抄**。
6. 你希望結果回答什麼？（值不值得維護／該不該推給同事）

## 第 2 步：生檔（預設放 `gauge/<skill名>-<YYYYMMDD>/`）

- 題目：每題一個 `case-NN-<slug>.prompt.md`（**兩組逐字相同的指令**）＋材料檔放 `materials/`。至少三題：從翻車案例做的**陷阱題**（陷阱寫在 gauge.json 的 note 給人看，不進指令）；**乾淨對照題**（完整無陷阱的材料，量「會不會把好的改壞」）；**負向對照題**（不該觸發的鄰近場景）。要有壓力測試就加一題 `type: pressure`。
- `pre-registration.md`：照模板填。條件四格、受測物、兩組定義（帶 skill 那組多的只有 `.claude/skills/<name>/`）、題組表、四類檢查項、規模（每組至少 3 次，寫死）、**能說／不能說現在寫死**。對照組誠實檢查：共用指令不含 skill 的核心指令詞；含了就在限制段寫「量到的是剩下的那一點差別」。
- `gauge.json`（引擎讀的，欄位見下）。**前置檢查（gate）必須兩組都做得到**——例如「有整理成會議記錄」可以，「有三區結構」不行（那是 skill 教的格式，會把不帶 skill 那組整批作廢）。事實／判斷兩類每條要能二元判定、能指出證據；取向觀察不計分。
- `results.md`：只填條件宣告與限制段骨架，數據留空。

`gauge.json` 欄位（範例：`exercises/fixtures/meeting-notes/gauge/gauge.json`）：
```
name, skill{name, path}, executorModel, judgeModel, runs, root(可 null),
cases[{id, type: trap|clean|negative|pressure, promptFile, materials[], assertions[ids], note}],
assertions[{id, family: gate|fact|judgment|orientation, text, cases[]}],
trigger{runs, should[…該觸發的指令], shouldNot[…不該觸發的鄰近指令]}   ← 可選
```

## 第 3 步：停——給人核可，再鎖定（不可跳過）

把 `pre-registration.md` 全文印出，問：「這份預先登錄可以嗎？可以我才鎖定並開跑；改了要重印。」使用者說可以之前，**不開跑、不寫任何結論**。核可後執行：
```
node <SKILL_DIR>/scripts/gauge.mjs lock --config gauge/<dir>/gauge.json
```
（鎖住預先登錄、gauge.json、題目、材料、skill 的雜湊；之後任何一樣改了，引擎會拒跑。要改就重新核可、重新 lock。）

## 第 4 步：跑（先報成本，再執行）

先算給使用者看：題數 × 2 組 × 次數 ＝ 幾次執行，每次約 10 秒到幾分鐘（看 skill）；加上同樣次數的評分。使用者說跑再跑。

- **Claude Code**：一行跑完（已知答案檢查 → **不帶 skill 那組先跑滿、盲評、套停案規則** → 帶 skill 那組 → 盲評 → 報告）：
  ```
  node <SKILL_DIR>/scripts/gauge.mjs all --config gauge/<dir>/gauge.json --out gauge/<dir>/runs/<YYYYMMDD-HHMM> [--with-trigger]
  ```
  **停案規則**（skill-forge 的「先確認不帶 skill 真的過不了」，這裡是量測前段）：不帶 skill 那組每條計分檢查每次都過 → 引擎停、不跑帶 skill 那組、報告寫 STOP——意思是這組題／這把尺測不出 skill 的貢獻：要嘛模型本來就會、要嘛題目太鬆。這時你的工作是跟使用者一起**改題**（更貼近真實翻車、更刁）或**停案**（skill 對這個模型沒必要），不是多跑幾次、也不是加 `--ignore-stop-rule` 硬跑。
  Windows 加 `--root D:\sg`（系統暫存目錄在使用者目錄底下，引擎會拒絕）。分段跑用 `run` / `grade` / `report`；已跑過的 run 不重跑（可續跑），要補跑就刪掉該 run 目錄再跑；`--interleave` 改回兩組交錯、不先跑基準組。**不可用 subagent 代替引擎跑兩組**——subagent 繼承你的環境，不是隔離。
- **Cowork／Desktop／Claude.ai**：跑不了引擎。照 README「不用 Claude Code 的同事怎麼跑」——你準備兩組的指令、材料與人工紀錄表，使用者自己開新對話跑，回填 results.md。

## 第 5 步：寫結果

讀 `report.md`（開頭「先看這裡」是引擎用資料生成的描述性摘要）。填 `results.md`：§1 條件表照 report 的「條件」段回填**實際**模型；§5 通過數、§6 成本照表；§7 灰區寫評分證據裡看到的模稜處；§10 天花板照 report 的旗標（零鑑別、帶 skill 反而較差、同格 run 高度相似、前置檢查偏向）。**結論措辭只能用 pre-registration 寫死的「能說」句式**；每一句能說都要帶差距與「翻幾格就反轉」。作廢與失敗的 run 沒補跑前，不寫總結句。

## 第 6 步：下一步——把量出來的東西接回建 skill 的迴圈

報告尾巴的「下一步」是引擎由旗標推導的三岔路，你照著帶使用者走，不要自己另起結論：
- **改題**（零鑑別、前置檢查偏向、同格 run 高度相似）：改 gauge.json／材料 → 重新核可＋lock → 再量。
- **改 skill**（帶 skill 反而較差、觸發率低）：把失分格的評分證據（`runs/<題>/with/r*/grading.json` 的 evidence）連同 skill 交給使用者建 skill 的工具（skill-forge create-skill 或官方 skill-creator）去改；**你不改 skill 內容**。改完用同一份鎖定的題目再跑一次，`node <SKILL_DIR>/scripts/gauge.mjs compare <舊 report.json> <新 report.json>` 看每條 held／regressed／improved——任何一條 regressed 都要單獨講，不能被總分平均掉。
- **停案或退役**（基準組全過）：先改題再量；改題後還是全過，就跟使用者說這個 skill 對這個模型沒必要。
模型更新、skill 改版都用同一招：舊 report 留著，再跑、再 compare。

## 四個停止點（違反其一，整次量測標無效）

1. 題目只來自使用者的翻車案例，不從 skill 本文推。
2. pre-registration 未經使用者說「可以」並 lock，不開跑。
3. 兩組用引擎跑（隔離的新程序、同指令、只差 skill 在不在）；不用 subagent。
4. 評分由引擎交給另一個新 session、不知道是哪組；你不自己打分。

## 精簡欄位表（找不到 `templates/` 時用）

- **case**：id／skill 版本快照／source（哪一次真實摩擦）／type｜Scenario（指令＋材料，兩組逐字相同）｜Baseline 對照（模型本來做不做得到）｜負向對照｜怎樣算通過（[結果][流程][風格][效率]）｜Run method｜Runs 表
- **pre-registration**：條件宣告（模型／harness／任務分佈／使用者既有能力）｜受測物（名稱＋版本、類型、預期效果的依據、兩組各拿到什麼＋誠實檢查）｜題組表｜四類檢查項｜規模（題×2×次，寫死）｜能說／不能說｜執行紀律
- **results**：實際組態｜開跑前處置｜前置檢查｜條件完整性｜逐項通過數｜成本｜判斷標準的灰區｜取向觀察｜能說／不能說／限制｜天花板檢查｜下一版候選
