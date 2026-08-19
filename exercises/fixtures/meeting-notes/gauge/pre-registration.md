# 預先登錄 — 教具 meeting-notes（十行會議記錄 skill）

> 這是教具用的預先登錄：目的是讓引擎跑得動、示範報告長什麼樣，**不是**要證明這個 skill 有用。真實量測請照 `templates/pre-registration.md` 完整填。

## 條件宣告

- 執行模型：`claude-sonnet-5`（矩陣另跑 `claude-haiku-4-5-20251001`）；評分模型：`claude-opus-5`
- harness：引擎隔離沙箱（家目錄以外的新目錄、`--setting-sources project --strict-mcp-config`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`），只放受測 skill
- 任務分佈：會議逐字稿整理（陷阱、乾淨、負向各一題）＋兩題壓力題（comply／exempt）
- 使用者既有能力：不適用（教具；指令由 fixture 給定）

## 受測物

- `skill/meeting-notes/SKILL.md`（十行）；第三組 `gauge/reminder/SKILL.md`（一句提醒）
- 預期效果的依據：skill 自己的宣稱（規則 1–5 逐字）——不是翻車案例
- 兩組拿到的東西逐字相同，唯一差別是 `.claude/skills/` 裡有沒有 skill；共用指令不含 skill 的核心指令詞（「決議／待辦／未決」三區只出現在 skill 裡）

## 題組與檢查項

見 `gauge.json`：5 題、12 條檢查項（前置檢查 1、事實檢查 5、判斷檢查 5（含兩條引擎自動加的「守住規則」）、取向觀察 1）。壓力題規則、壓力種類、預期行為寫在各題欄位。

## 規模

- 每組每題 `runs` 次（gauge.json 預設 3；教具實跑常用 1–2，報告會寫實際次數）
- 觸發題 8＋8，每題 2 次

## 可說明／無法說明（先寫死）

- 可說明：只限這次條件下的描述性數字——各組通過幾格、差幾格、翻幾格反轉、觸發幾次、壓力下守住幾次
- 無法說明：因果通則、外推到題組以外的任務、跨模型互比（矩陣各格各自看）、「skill 有用／沒用」的定論
- 停案規則：不帶 skill 那組每條計分檢查每次都過 → 停，寫「這組題測不出 skill 的貢獻」

## 執行規則

- 引擎跑，不用 subagent；已知答案檢查未過不開跑；評分交給新 session、不知道是哪組
- 鎖定後改題目要重新核可＋`lock --relock`
