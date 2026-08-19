# Roadmap

> skill-gauge 是一套測量 AI skill 有沒有用的方法（怎麼用見 [README](../README.md)）。v0 只放三樣東西：模板、一個實際測過的範例、一題練習。這一頁記的是下一步——已經決定要做、但 v0 先不做的設計，還有做完那個範例之後發現值得補的地方。

## 加一組對照：假的 skill

v0 的測法只有兩組：一組不給 skill，一組給真的 skill。這樣分不出兩件事——AI 變好，是因為「收到了指示」，還是因為「指示的內容」。所以要有第三組，給一份假的 skill（v1.1 起引擎已支援：`arms` 加一組指到另一個 skill 資料夾——教具用「一句提醒」，也可以用結構和長度跟真的差不多、內容中性的假 skill；引擎**不驗證**第三組的長度／結構是否真的匹配，那是出題者的責任）。真的比假的好多少，才是內容本身的效果。

這兩篇的依據都來自臨床試驗的做法。這個做法叫 attention control。也叫 active control。作法是給對照組一個看起來一樣、內容中性的介入，把「有被介入」的效應拉平。要提醒的是，它們談的是臨床試驗。沒有測過 AI skill，套到這裡是我們自己的推論。

- Lindquist et al. 2007 — <https://pubmed.ncbi.nlm.nih.gov/17760793/>
- Popp & Schneider 2015 — <https://trialsjournal.biomedcentral.com/articles/10.1186/s13063-015-0679-0>

但書：這兩篇要一起引用才站得住，只引其中一篇，證據會不太夠。

## 每份報告都要回答的一題

結果報告固定加一個問句：「**藏在背後的偏誤要多大，才會讓這個結論反過來？**」讀者看了就知道，這個結論離被推翻還有多遠。results 模板裡已經預留好位置，在第 9 節「限制」的最後。**注意**：引擎現在輸出的「翻幾格就反轉」是脆弱度計數（fragility count：改幾個格子的判定，差距就抹平或反轉），**不是**這裡說的 Rosenbaum 敏感度分析——後者問的是隱藏偏誤要多大，是另一件還沒做的事。

文獻依據：Rosenbaum 的敏感度分析框架 — <https://onlinelibrary.wiley.com/doi/abs/10.1002/0470013192.bsa606>

但書：Rosenbaum 的敏感度分析是一系列著作累積的框架，不是單一一篇論文。引用時照這個措辭寫，不指向特定文章。

## 已在 v1.1 做進去的（2026-08-18）

- 第三組「一句提醒／假 skill」（見上一節）——引擎的 `arms` 可加第三組，報告拆「有被指示的功勞」與「內容的功勞」。
- 壓力測試（`type: pressure`：規則、疊加的壓力、預期 comply／exempt、合理化說詞逐字擷取）。
- 多模型×effort 矩陣（`matrix`）、描述優化迴圈（`describe`，held-out 選最佳、預設不寫回）、回歸歷史（`history.jsonl`＋`compare --config`）。
- 報告 HTML（`report.html`／`matrix.html`／`describe.html`，含逐份看產出）。
- 打包成 plugin（`.claude-plugin/`）：`claude plugin marketplace add` → `claude plugin install`，mac 實測可裝。
- 假模型端到端測試進 CI（`stub-claude.mjs`＋`e2e-stub.mjs`）。

## v2 確證版（confirmatory）——能支持「在宣告條件內，放進 skill 造成 Δ」的因果宣稱

08-18 傍晚 codex sol 第三、四輪（`docs/reviews/2026-08-18/out-C-causal.md`、`out-D-landscape.md`）的結論：檯面上官方 skill-creator＝探索性、`claude plugin eval` 與 skill-forge eval-skill＝工程級、skill-gauge＝工程級；**沒有任何一個達到確證級**。要到確證級，缺的不是功能，是把量測效度、宣稱邊界與不確定性變成機械契約。優先順序（codex 建議、維護者待裁）：
1. **介入後排除**：現在前置檢查沒過的 run 作廢不計分——skill 若造成拒答或不可評，等於偏向 skill。確證階段改 ITT：拒答／作廢算不通過，一併進主要指標。
2. **真正的配對隨機**：AB／BA 區塊隨機順序＋同時段交錯（`schedule.json`），pilot（停案用）與 formal 分流、pilot 資料不進差值。
3. **單一二元主要指標＋配對區間＋功效**：例如逐題「全部計分檢查通過」；配對差用 Newcombe／McNemar 類區間；開跑前算樣本數（McNemar：m≈[1.96√q＋0.84√(q−Δ²)]²／Δ²；偵測 15 個百分點差、不一致率 q＝0.30 時約 103 個配對區塊——20 題×6 次量級，遠大於教具的 5 題×2 次）；其餘檢查項一律探索性。
4. lock 升級為 prepare→approve→pilot→confirm→analyze 狀態機，protocol id 內容定址，`--force` 不得跳過。
5. 評分者效度：人工 gold set＋混淆矩陣／κ、雙評分與裁決規則、canonical 模型收據。
6. 陽性對照（合成的、已知會被抓到的錯）：不是正向結果的必要條件，但對「沒差」的結論很重要。
第二階段：JSON Schema／原始事件 manifest／真 append-only history／跨日跨機獨立重跑。能說的範本：「在 protocol {id} 宣告的條件內，加入 skill 使主要指標的機率改變 Δ 個百分點（95% 區間 L–U）」；不能說：「skill 本質上、跨條件有效／無效」。

## 下一版（v1.2）——含 08-18 codex 審查後留下的項目

兩位獨立審查者（codex gpt-5.6-sol，read-only）在 08-18 各審一輪，能當天修的都修了（c663fac、fcb8d44）；以下是明說「還沒做」的：

- ~~核可頁~~ **已完成（2026-08-18）**：新增 `preview` 子指令，把 `gauge.json`＋`pre-registration.md` 整理成一頁核可頁（`preview.html`，不用 `claude` 也能出、不寫 lock）——維護者 dogfood v1.1 時發現第 3 步把 `pre-registration.md` 全文貼進對話不可讀，SKILL.md 第 3 步改為出核可頁給人看、說「可以」才鎖定；斷言加 `label`（給人看的白話版，`text` 仍是給評分者的判斷句，兩者分離）。
- 停止點機械化：`prepare`／`approve`／`run` 狀態機，核可留收據，`all` 只接受 approved 狀態（現在四個停止點靠 SKILL.md 文字＋lock）。
- 正式資料契約：`report.json`／`matrix.json`／`describe.json`／`grading.json`／`meta.json`／`lock.json`／`history.jsonl` 各一份 JSON Schema＋`contractVersion`；grading 記 assertion 集雜湊（同目錄改檢查項時不沿用舊評分）。
- 描述優化改三分（train／validation／final test）：validation 選版本、final test 只對選定版本跑一次；description 讀寫換真正的 YAML parser（block scalar 含空白行會寫壞）。
- 停案規則的時間漂移：pilot 基準決定停不停；正式比較改交錯（blocked random order），pilot 基準不進差值。
- 安全邊界：OS／容器層沙箱、低權限帳號與短效 token、`--bare` 跳過 hook、Windows 不走 `shell:true`；目前只做到環境變數白名單、不跟隨 symlink、評分者無工具——**它不是不可信程式的安全沙箱**，README 與 SKILL.md 都這樣寫。
- 假模型 e2e 加 fault-injection（執行 crash、評分壞 JSON、逾時、半數失敗、stream 形狀漂移）；CI 加 Windows。
- 把量測結果輸出成官方 `claude plugin eval` 的評測格式，或反過來把官方 eval 當 executor adapter——skill-gauge 專注方法層（出題、對照組、預先登錄、可說明／無法說明、壓力測試、描述優化、回歸敘事）。
- 跨 CLI（codex）那一路：同一份題目、同一份鎖定，換執行 CLI 再跑；兩邊結果分層、不互相當基準。
- 外掛（plugin）與帶 hook 的受測物是個問題。目前的隔離做法載不到使用者層的外掛。效果測量現在只能不隔離著跑，並且要標明這件事。之後要另外設計解法。
- Windows 上的引擎實跑（程式寫了 `shell:true` 與 `--root`，還沒在 Windows 跑過）；MCP 的已知答案題。
- 成本硬上限（`--max-cost-usd` 那種：撞到就中止並報部分結果）。

## Skill 的三種類型（模板裡的「類型」欄就是填這個）

這三種類型是我在 2026-08-11 提出的分類方式。模板裡已經把「類型」欄設成必填。量測設計的第一步，是先認出要測的 skill 屬於哪一種類型。類型不同，判斷標準的設計方式也不同。這三種類型是從三個實際案例歸納出來的：

| 型 | 例 | 產出長什麼樣 | 量測設計跟著變什麼 |
|----|-----|-------------|------------------|
| 產出物型 | viz-explain（把技術討論變成一頁說明網頁的 skill） | 一份檔案／頁面 | 判斷標準可以做成機械化檢查，直接套用四類檢查項（斷言就是一條能直接判對錯的檢查句）就好。 |
| 方法注入型 | superpowers（教 AI 怎麼想的方法外掛） | 改變 AI 做事的方式，效果散在過程中 | 量測標準要逐字引用官方的說明文字，並把「使用方式是否照官方說明操作」放進前置檢查。 |
| 互動型 | grill-me（追問式對話 skill） | 一場與使用者的對話 | 評分要靠 AI 判斷這場對話的品質，主觀性最重；而且效果會隨使用者原本的能力變化，所以「在誰身上測的」是必填欄位。 |

這三種類型不是全部列完了，以後遇到新的類型，就在表格裡加一行。roadmap 的方向，是幫每一種類型都準備一份判斷標準的起手模板。

## 實測範例遺留的下一版候選

完整清單在 [範例 RESULTS §11–12](../examples/viz-explain-v2/RESULTS.md)。以下幾條是方法層通用的部分：

- 條件式斷言要改成正向要求，例如「必須引用且必須保留脈絡」，不要獎勵迴避的答法。
- 同一位評分者評完整組，設成預設做法；如果做不到，就改成兩人各評一次再裁決。
- 機械證據層要對渲染後的 DOM 取文字，不能只掃靜態原始碼。
- 出處註記或頁尾的後設資料算不算數，判斷標準要先寫死，不能臨場決定。
- 取向觀察要不要升格進計分，每一題都要單獨裁決，不能一次套用到全部。
- 評測鷹架詞，例如「事實包」這類內部用語，不能出現在題目 prompt 裡。這樣才能避免外洩到成品裡。

## 2026-08-19 codex 全包複核留下的待辦（引擎面；分享會前只改文件，紀錄在 docs/reviews/2026-08-19/）

- lock 只鎖檔案：`--runs`／`--judge-model`／`--effort`／matrix 的 `--models --efforts` 可在核可後覆寫且核可頁看不到；`baseline`／`trigger`／`describe` 不驗 lock、不做已知答案檢查；`--runs 0` 或非數字沒擋
- 停案 INCOMPLETE 規則與 SKILL 第 4 步不一致（只在「有效格全過但不完整」才判 INCOMPLETE）；INCOMPLETE 也不停 pipeline
- 從 runs/ 內 gauge.json 副本載入時相對路徑少一層（`grade --out`／`report --out`）；分段 `run` 不寫 effective.json；`grade`／`report` 不驗 lock；同 judge 的舊 grading.json 直接沿用
- 資料不完整仍出粗分與翻格句；摘要沒把 pre-registration 的可說明／無法說明原文帶進來
- 產出 >2 MiB 略過不記、評分輸入 60,000 字截斷未上浮到報告、HTML 只列前六個 artifact
- sandbox 路徑含 arm 名（with／without／reminder）——受測模型 `pwd` 就知道自己是哪組；executor 預設不限工具
- arms 順序沒契約（第一個當受測、第二個當對照）；第三組 skillPath 不先驗 SKILL.md 存在
- 零計分格仍可判 STOP；lock／compare 不綁引擎版本
- 模板要求「先 commit」與 SKILL 用 lock 矛盾；gate 放格式的說法前後矛盾；results 模板 §1–§6 全填 vs SKILL 第 5 步只填部分
- 已知答案檢查是固定題（全域規則對回應語言的要求＋skill 名），不是使用者自選；INCONCLUSIVE 仍 iso.ok=true 繼續
- Windows 引擎實跑：待 testing.md 有紀錄才可寫「通用」；CI 只有 Ubuntu
- 轉 public 前：docs/reviews/ 內本機絕對路徑要脫敏（08-19 16:26 已做，改寫成 <repo>/、~/）；gauge/ 整個已移出版控

