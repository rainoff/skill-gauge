# skill-gauge 自己怎麼被測（測試履歷）

> 量測工具自己也要被量。這頁記三件事：引擎每次改版跑了什麼、結果是什麼、還沒測到什麼。新增一列比多寫一句保證有用。

## 三層自我檢查

| 層 | 做什麼 | 什麼時候跑 | 指令 |
|---|---|---|---|
| 自我測試 | 純函式與報告數學（祖先掃描、相似度、JSON 抽取、回歸比較、敏感度）；不呼叫模型，幾秒跑完 | 每次改引擎；GitHub Actions 每次 push | `node .claude/skills/skill-gauge/scripts/selftest.mjs` |
| 已知答案檢查 | 開跑前兩題兩臂：規則題（不帶開關要讀到全域規則、帶了要 NO-RULES）＋skill 題（放了要 YES、沒放要 NO） | 每次 `all`／`run`／`baseline` 自動 | `node scripts/gauge.mjs check-isolation --skill <dir>` |
| 評分者自證 | 先拿一份明顯通過、一份明顯不通過的產出考評分模型；判錯就不准評真的 | 每次 `grade` 自動（每個輸出目錄一次） | 隨 `grade` 執行，結果在 `grader-selfcheck.json` |

## 履歷（append-only；引擎版本＝commit）

| 日期 | 引擎 | 機器 | 跑什麼 | 結果 | 備註 |
|---|---|---|---|---|---|
| 2026-08-18 | 25b241e | mac（claude 2.1.234，node 24） | 教具 meeting-notes，`all --runs 1` | 已知答案 rules PASS／skill PASS；抓到前置檢查偏向（不帶 skill 組作廢） | 前置檢查改成兩組都做得到；引擎加偏向旗標與白話摘要 |
| 2026-08-18 | 25b241e | mac | 教具，`all --runs 2 --with-trigger` | 12/12 vs 12/12（零鑑別）；觸發 4/4、誤觸發 0/4；輸入鎖定一致 | 兩組成本各約 11 秒 |
| 2026-08-18 | 6665229 | mac | 教具，`all --runs 1`（停案規則預設） | 基準組 3 題各 1 次全過 → STOP，未跑帶 skill 組 | 停案規則第一次實跑 |
| 2026-08-18 | 6aa5aa4 | mac | 教具（去掉 skill），`baseline --runs 1` | 基準在 judgment-no-forced-sections 0/1 沒全過 → CONTINUE | 同題上一輪全過、這輪失手：浮動的實例 |
| 2026-08-18 | e013d95 | mac | `selftest`；`grade` 評分者自證（opus） | 11/11；good=true／bad=false PASS | — |
| 2026-08-18 | 本次 | mac | 教具三組（with／without／reminder 一句提醒），`all --runs 1 --interleave` | 6/6／6/6／6/6；提醒的功勞 0、內容的功勞 0 | 第三組第一次實跑；教具對 sonnet 三組全過（稅） |

## 還沒測到的

- Windows：引擎寫了 `shell:true` 與 `--root`（拒絕 `%TEMP%`），沒實跑
- MCP：沒有已知答案題；`--strict-mcp-config` 的效果未驗
- 外掛（plugin）與帶 hook 的受測物：v1 不支援隔離量測
- 引擎自己的端到端測試只在一個教具、一台機器上跑過；真 skill 的第一次量測見履歷下一列
