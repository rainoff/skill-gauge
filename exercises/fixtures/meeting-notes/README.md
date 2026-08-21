# 教具跑法（meeting-notes fixture）

一個十行的會議記錄 skill＋能直接執行的 `gauge.json`（壓力題、16 題觸發題、兩格矩陣）。三組約 9 分鐘（維護者 08-18 mac 實跑，僅估算）；`--runs 1` 是試跑、不當結論——正式輪照核可頁鎖定的次數。

**真跑（會花 API 費用）：**

```zsh
cd exercises/fixtures/meeting-notes
node ../../../scripts/gauge.mjs all --config gauge/gauge.json --out /tmp/sg-demo --runs 1
```

**免花錢（假模型走一遍，看產出檔案長什麼樣）：**

```zsh
GAUGE_CLAUDE_CMD="node <repo>/.claude/skills/skill-gauge/scripts/stub-claude.mjs" \
node ../../../scripts/gauge.mjs all --config gauge/gauge.json --out /tmp/sg-demo --runs 1
```

（`<repo>` 換成 clone 的絕對路徑。）
