# skill-gauge 自己怎麼被測（測試履歷）

> 量測工具自己也要被量。這頁記三件事：引擎每次改版跑了什麼、結果是什麼、還沒測到什麼。新增一列比多寫一句保證有用。

## 四層自我檢查

| 層 | 做什麼 | 什麼時候跑 | 指令 |
|---|---|---|---|
| 自我測試 | 純函式與報告數學（祖先掃描、相似度、JSON 抽取、回歸比較、敏感度、觸發彙整、train／test 切分、description 讀寫、壓力判定抽取與極性、矩陣併表、歷史配對、HTML 渲染）；不呼叫模型，幾秒跑完 | 每次改引擎；GitHub Actions 每次 push | `node .claude/skills/skill-gauge/scripts/selftest.mjs` |
| 假模型端到端 | 用寫死行為的假 `claude`（`stub-claude.mjs`）把教具走完整條流程：lock（含拒絕靜默覆寫、要求預先登錄）→ all（觸發＋壓力題）→ matrix → describe → compare → html → 停案路徑（安全探針）→ baseline；驗的是每一段接得起來、檔案形狀對、關鍵判定對（停案、壓力守住／折了、提案輪有進步、預設不寫回、續跑條件、history 去重） | 每次改引擎；GitHub Actions 每次 push（不打 API） | `node .claude/skills/skill-gauge/scripts/e2e-stub.mjs` |
| 已知答案檢查 | 開跑前兩題兩組：規則題（不帶開關要讀到全域規則、帶了要 NO-RULES）＋skill 題（放了要 YES、沒放要 NO） | 每次 `all`／`run`／`baseline`／`matrix` 自動 | `node scripts/gauge.mjs check-isolation --skill <dir>` |
| 評分者自證 | 先拿一份明顯通過、一份明顯不通過的產出考評分模型；判錯就不准評真的 | 每次 `grade` 自動（每個輸出目錄一次；矩陣一次、複製到每格） | 隨 `grade` 執行，結果在 `grader-selfcheck.json` |

假模型端到端的邊界要說清楚：它證明的是**引擎**（流程、檔案、判定邏輯）在沒有真模型時也對；它證明不了任何跟模型有關的事（觸發率、評分品質、隔離是否真的擋住東西）——那些只有下面履歷裡的真跑才算。

## 履歷（append-only；引擎版本＝commit）

| 日期 | 引擎 | 機器 | 跑什麼 | 結果 | 備註 |
|---|---|---|---|---|---|
| 2026-08-18 | 25b241e | mac（claude 2.1.234，node 24） | 教具 meeting-notes，`all --runs 1` | 已知答案 rules PASS／skill PASS；抓到前置檢查偏向（不帶 skill 組作廢） | 前置檢查改成兩組都做得到；引擎加偏向旗標與白話摘要 |
| 2026-08-18 | 25b241e | mac | 教具，`all --runs 2 --with-trigger` | 12/12 vs 12/12（零鑑別）；觸發 4/4、誤觸發 0/4；輸入鎖定一致 | 兩組成本各約 11 秒 |
| 2026-08-18 | 6665229 | mac | 教具，`all --runs 1`（停案規則預設） | 基準組 3 題各 1 次全過 → STOP，未跑帶 skill 組 | 停案規則第一次實跑 |
| 2026-08-18 | 6aa5aa4 | mac | 教具（去掉 skill），`baseline --runs 1` | 基準在 judgment-no-forced-sections 0/1 沒全過 → CONTINUE | 同題上一輪全過、這輪失手：浮動的實例 |
| 2026-08-18 | e013d95 | mac | `selftest`；`grade` 評分者自證（opus） | 11/11；good=true／bad=false PASS | — |
| 2026-08-18 | 3240609 | mac | 教具三組（with／without／reminder 一句提醒），`all --runs 1 --interleave` | 6/6／6/6／6/6；提醒的功勞 0、內容的功勞 0 | 第三組第一次實跑；教具對 sonnet 三組全過（稅） |
| 2026-08-18 | 2f4d64e | mac（claude 2.1.234，node 24） | `selftest`；`e2e-stub`（假模型端到端） | 40/40；28/28 | v1.1 第一次：壓力題、矩陣、描述優化、HTML、history 全走過 |
| 2026-08-18 | 2f4d64e | mac | 教具 `matrix --runs 2 --with-trigger --parallel 3`（sonnet／haiku 兩格；5 題含 2 壓力題、3 組、觸發 8＋8） | **sonnet 格 STOP**：基準 24/24 全過（含兩題壓力都守住），未跑帶 skill 組；觸發 14/16、誤觸發 0/16。**haiku 格 CONTINUE**：with 18/18、without 16/18、reminder 18/18（提醒的功勞 2、內容的功勞 0）；觸發 10/16、誤觸發 0/16；壓力題 comply 三組都 0/2 守住——不是折了，是**三組都拒絕交付**（硬套規則／拒做，說詞逐字擷取 6 筆）；exempt 三組 2/2；6 次作廢全在 case-04（拒答→前置檢查沒過） | 矩陣「A 停案、B 繼續」第一次真實出現；壓力題暴露「拒答算什麼」的判法問題（見下方還沒測到的） |
| 2026-08-18 | 2f4d64e | mac | 教具 `describe --rounds 2 --runs 2`（原 description） | 第 0 輪 train 10/10、held-out 6/6 → 提前停止、不提案 | 原描述已夠好；迴圈老實地不換 |
| 2026-08-18 | 2f4d64e→645d4b6 | mac | 弱描述示範 `describe --rounds 3 --runs 2`（`gauge-describe-demo.json`，description 故意寫成「整理文件或會議內容時使用」） | 第 0 輪 train 8/10（PRD／技術筆記濃縮誤觸發）、held-out 6/6；第 1 輪 9/10／6/6；第 2 輪 9/10／5/6；第 3 輪 10/10／5/6 → 最佳第 1 輪（held-out 同分看 train） | held-out 6 題分不出後三輪，正是「held-out 太小」的實例；提案模型 opus |
| 2026-08-18 | 2f4d64e | mac | plugin 安裝：`claude plugin marketplace add <本機路徑>` → `claude plugin install skill-gauge@skill-gauge --scope local` → `claude plugin details` | 裝成功；Skills (1) skill-gauge；常駐約 380 token；測完已 uninstall＋remove | 觸發方式三種（clone／複製 skill 資料夾／plugin）都有一種實測 |
| 2026-08-18 | c663fac | mac | codex sol（gpt-5.6-sol，xhigh，read-only）系統審查 10 項發現→修 8 項＋2 項部分；`selftest` 41/41、`e2e-stub` 34/34；環境變數白名單後 `check-isolation` 真跑 | rules PASS／skill PASS | 審查原文與處置見 session 交接檔；環境白名單不影響 claude 登入 |
| 2026-08-18 | fcb8d44 | mac | codex sol 第二輪（對抗性複核今日變更）14 項發現→修 11 項＋3 項部分；`selftest` 46/46、`e2e-stub` 38/38（新增停案＋安全探針、鎖定語意、續跑條件）；haiku 格報告用新引擎重出（壓力題 comply 三組由「過度套用」正規化為「拒做」） | 通過 | 兩輪審查的處置表見 session 交接檔的設計審查看板 |
| 2026-08-18 | 2c4feab＋critic 修正 | mac | 核可頁（`preview`）：`selftest` 77/77（摘要結論：不出現 id、贏輸挑對、停案句、label 首子句、HTML 第一區塊；新增可說明／無法說明擷取含合併標題與英文、buildPreview 成本數學（口徑照引擎：已知答案檢查依不同執行模型數、自證一次、觸發另計）、baseline-only 只列基準組、label 顯示、mdToHtml、renderPreviewHtml）；`e2e-stub` 43/43（report.md 開頭是摘要結論；新增未鎖定／已鎖定／不一致三態，且不需要 claude 也能跑）；教具 `PATH=/usr/bin:/bin node scripts/gauge.mjs preview --config exercises/fixtures/meeting-notes/gauge/gauge.json` | 通過；輸出 0 個 http 字樣（自含 HTML）；教具成本估算＝(45 執行＋45 評分)×2 格＋已知答案 8（2 模型各 4）＋自證 2＝190 次（停案時最少 142 次）；觸發 32 次另計 | v1.1 dogfood 發現第 3 步全文貼 pre-registration.md 不可讀後新增；維護者讀 clarify 真測報告後裁「沒人陪讀看不懂」→ 報告開頭加「摘要結論（給人看的一頁）」四問（引擎產出、不靠 AI、不出現 id）；critic（opus，fresh context）審過：成本口徑高估、baseline-only 顯示兩組、合併標題誤標「能說」、版本號不一致（→1.1.1）四條已修 |
| 2026-08-19 | （本 commit） | mac | 用詞改版：報告摘要標籤 贏在哪／輸在哪／下一步 → 優點在哪／缺點在哪／該怎麼改；「能說／不能說」→「可說明／無法說明」（擷取 regex 兩邊都認、舊 pre-registration 不用改）；檢查項族名 事實紀律／判斷紀律 → 事實檢查／判斷檢查、執行紀律 → 執行規則、壓力測試副標改「規則在壓力下守不守得住」；`selftest` 79/79（新增新詞合併標題／分開標題兩則，「無法說明」不得被當可說明；摘要標籤斷言改新詞並斷言舊詞不再出現）、`e2e-stub` 43/43；clarify 08-18 報告以 `html --out` 重出（只換標籤、數字不變） | 通過 | 只改字串與 regex，不動計分；`report --out` 對 runs/ 內的 gauge.json 副本會把相對 skill 路徑解析錯（少一層）——今天用 `html` 繞過，待修 |

## 還沒測到的

- Windows：引擎寫了 `shell:true` 與 `--root`（拒絕 `%TEMP%`），沒實跑
- MCP：沒有已知答案題；`--strict-mcp-config` 的效果未驗
- 外掛（plugin）與帶 hook 的受測物：v1 不支援隔離量測
- 真 skill（不是教具）的第一次量測還沒發生；矩陣、描述優化、壓力題都只在教具上跑過
- 壓力題的判法：受測者「拒絕交付、只反問」被評分者歸為 overapplied（硬套規則／拒做正當工作）並讓前置檢查作廢——這個判法是引擎第一版的選擇，只在 haiku 六次上看過，沒有第二種模型的對照
- 假模型 e2e 只測接得起來與關鍵判定，沒有 fault-injection（執行 crash、評分壞 JSON、逾時、半數失敗）
- 沙箱環境變數白名單：只確認 claude 登入與已知答案檢查在 mac 上照常；Windows／API key 登入／代理環境未驗
