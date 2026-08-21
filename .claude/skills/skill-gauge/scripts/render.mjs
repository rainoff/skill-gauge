#!/usr/bin/env node
// skill-gauge 報告檢視器（v1）— 把量測結果的 JSON 轉成一頁可以直接開的 HTML。
//
//   node scripts/render.mjs <report.json|matrix.json|describe.json> [out.html]
//   （沒給 out.html 就印到 stdout；分派看檔內 kind 欄位，沒有 kind 就看欄位形狀）
//
// 也可以當模組用：
//   import { renderReportHtml, renderMatrixHtml, renderDescribeHtml } from './render.mjs';
//
// 產出是自含的一頁 HTML：CSS 與 JS 全部寫在檔案裡，不載字型、不連 CDN、不發任何請求，
// 離線可讀、可以直接寄給人。零依賴，只用 node:fs 與 node:path，Node ≥ 18。
//
// 缺欄位一律優雅降級：該區塊直接不顯示，或標「未跑」；不會因為少一個欄位就整份炸掉。

import fs from 'node:fs';
import path from 'node:path';

// ---------- 小工具 ----------
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const asArr = (x) => (Array.isArray(x) ? x : []);
const asObj = (x) => (isObj(x) ? x : {});
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const txt = (x) => (x === null || x === undefined ? '' : String(x));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (x) => txt(x).replace(/[&<>"']/g, (c) => ESC[c]);
const nz = (x) => (x === null || x === undefined || x === '' ? null : x);

// 數字：整數就整數，小數留一位；不是數字就回 null
function fmtNum(x, digits) {
  const n = num(x);
  if (n === null) return null;
  if (digits !== undefined) return n.toFixed(digits);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
const dash = (s) => (s === null || s === undefined || s === '' ? '—' : s);
const fmtOr = (x, digits) => dash(fmtNum(x, digits));
// 比例（相似度那些）不四捨五入：引擎已經取到小數第三位，再壓一次會把 0.572 跟 0.579 變成同一個數字
const fmtRatio = (x) => (num(x) === null ? '—' : String(num(x)));
// 美元：位數自適應（同一組要比較的值取共同位數，避免不同值顯示成一樣、或都顯示成 $0.000）；預設 3 位，最多到 6 位。
// 這兩個函式跟 gauge.mjs 的同名函式是同一套規則（render.mjs 保持零 import，所以留一份複本；
// selftest 逐值對照兩邊輸出必須完全相同，任一邊改了另一邊沒改就會紅）。
// distinct 用原值嚴格不等（不經 toFixed(10)；理由同 gauge.mjs 的 usdDigits，v1.5-3）
export function usdDigits(vals, { min = 3, max = 6 } = {}) {
  const nums = (vals || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return min;
  const distinct = new Set(nums).size;
  for (let d = min; d < max; d++) { if (new Set(nums.map((v) => v.toFixed(d))).size >= distinct) return d; }
  return max;
}
export function fmtUsd(x, digits = 3, { raw = false } = {}) {
  const v = num(x);
  if (v === null || !Number.isFinite(v)) return null;
  const eps = Math.pow(10, -digits);
  if (v !== 0 && Math.abs(v) < eps) return `<$${eps.toFixed(digits)}（原值 ${v}）`;
  const s = `$${v.toFixed(digits)}`;
  // raw＝這一組值到了位數上限還是印成同一串：附原值，不同金額不印成同一串（正式裁定 v1.4-6）
  return raw && +v.toFixed(digits) !== v ? `${s}（原值 ${v}）` : s;
}
// 一組要互相比較的金額共用一個 formatter（跟 gauge.mjs 的 usdFmt 同一套規則，selftest 逐值對照）
export function usdFmt(vals, opts = {}) {
  const digits = usdDigits(vals, opts);
  const nums = (vals || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const distinct = new Set(nums).size; // 原值嚴格不等，理由同 usdDigits（v1.5-3）
  const collides = new Set(nums.map((v) => v.toFixed(digits))).size < distinct;
  const f = (x) => fmtUsd(x, digits, { raw: collides });
  f.digits = digits; f.collides = collides;
  return f;
}
// 時長：超過兩分鐘改用分，不然逾時的 run 會出現「1200.0 秒」
function fmtDur(sec) {
  const s = num(sec);
  if (s === null) return null;
  return s >= 120 ? `${(s / 60).toFixed(1)} 分` : `${s.toFixed(1)} 秒`;
}

// r1、r2、r10 這種編號要照數字排，不是照字串排
function natCmp(a, b) {
  const ra = /^(\D*)(\d+)$/.exec(txt(a)), rb = /^(\D*)(\d+)$/.exec(txt(b));
  if (ra && rb && ra[1] === rb[1]) return Number(ra[2]) - Number(rb[2]);
  return txt(a).localeCompare(txt(b));
}

// 秒／毫秒
const secFromMs = (ms) => (num(ms) === null ? null : num(ms) / 1000);

// 舊報告（1.1.x，重出時沒有場景全對制那組欄位）偵測：依欄位存在判斷，不依總格數（正式裁定 v1.4-5）。
// benefit／costFlow／cost[arm] 的場景全對制欄位（successRuns 等）任一存在＝新報告；三者都沒有才是舊報告——
// 全站只留這一個判斷點，不要每個消費者各自猜一次（v1.5-4：舊的判斷只看 cost 欄位，secKeyPoints 沒接，漏了兩處措辭）。
function isNewReportShape(r) {
  const ro = asObj(r);
  if (isObj(ro.benefit)) return true;
  if (isObj(ro.costFlow)) return true;
  const cost = asObj(ro.cost);
  return Object.values(cost).some((c) => {
    const co = asObj(c);
    return co.successRuns !== undefined || co.notFirstPassRuns !== undefined || co.indeterminateRuns !== undefined || co.discardedRuns !== undefined || co.perSuccessCostUsd !== undefined || co.costComplete !== undefined;
  });
}

// ---------- 中文對照 ----------
const FAMILY_LABEL = { gate: '前置檢查', fact: '事實檢查', judgment: '判斷檢查', orientation: '取向觀察' };
const FAMILY_UNSCORED = new Set(['gate', 'orientation']);
const FAMILY_ORDER = { gate: 0, fact: 1, judgment: 2, orientation: 3 };
const CASE_TYPE = { trap: '陷阱題', clean: '乾淨對照題', negative: '負向對照題', pressure: '壓力測試題' };
const ARM_LABEL = { with: '帶 skill', without: '不帶 skill', reminder: '一句提醒' };
const BASELINE_VERDICT = { STOP: '停案', CONTINUE: '繼續', 'NO-DATA': '沒有有效資料' };
const PRESSURE_VERDICT = { held: '守住', violated: '違規', overapplied: '過度套用', refused: '拒做／沒交付', inconclusive: '判不出來' };
const EXPECTED_BEHAVIOR = { comply: '應照做（不豁免）', exempt: '應豁免' };

const familyLabel = (f) => FAMILY_LABEL[f] || (nz(txt(f)) ? txt(f) : '未標類別');
const caseTypeLabel = (t) => CASE_TYPE[t] || txt(t);
const armName = (a) => (ARM_LABEL[a] ? `${ARM_LABEL[a]}（${a}）` : txt(a));
// 句子裡接中文時用這個：全形括號後面不要再補空格
const armSay = (a) => {
  const s = armName(a);
  return /[）)]$/.test(s) ? s : s + ' ';
};
const armHeadHtml = (a) =>
  ARM_LABEL[a] ? `${esc(ARM_LABEL[a])}<span class="id">${esc(a)}</span>` : `<span class="id">${esc(a)}</span>`;

// 斷言的顯示文字：有 label 就顯示 label（給人看的白話版），text（給評分者的判斷句）放 title 屬性；沒有 label 就顯示 text
function assertionDispHtml(o) {
  const meta = asObj(o);
  const label = nz(meta.label), text = nz(meta.text);
  const disp = label != null ? label : text;
  if (disp == null) return '';
  const title = label != null && text != null && label !== text ? ` title="${esc(txt(text))}"` : '';
  return `<div class="small dim"${title}>${esc(txt(disp))}</div>`;
}

// ---------- HTML 骨架 ----------
const LIGHT_TOKENS = `
  color-scheme: light;
  --bg:#fbfaf8; --panel:#ffffff; --panel-2:#f3f4f6; --panel-3:#e8ebef;
  --fg:#1b1f24; --fg-dim:#555d66; --fg-faint:#828a93;
  --line:#e2e6ea; --line-2:#c7ced6;
  --accent:#17627a; --accent-2:#0e4a5d;
  --heat:23 98 122;
  --ok:#2b7a4b; --warn:#8a6206; --bad:#a03e36; --info:#3a5f8a;
  --chip:#eef1f4; --quote:#f6f7f9;
  --shadow:0 1px 2px rgba(20,28,36,.06), 0 2px 10px rgba(20,28,36,.04);
`;
const DARK_TOKENS = `
  color-scheme: dark;
  --bg:#111418; --panel:#171b21; --panel-2:#1e232a; --panel-3:#262c34;
  --fg:#e7eaee; --fg-dim:#aab3bd; --fg-faint:#7f8892;
  --line:#2a3038; --line-2:#3b434d;
  --accent:#7cc3da; --accent-2:#a5dcee;
  --heat:124 195 218;
  --ok:#79c48f; --warn:#dcb160; --bad:#e79189; --info:#8fb4e0;
  --chip:#232a32; --quote:#1c2128;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 2px 12px rgba(0,0,0,.25);
`;

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{${LIGHT_TOKENS}
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue","PingFang TC","Noto Sans TC","Microsoft JhengHei","Hiragino Sans",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --radius:10px;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK_TOKENS}}}
:root[data-theme="dark"]{${DARK_TOKENS}}

html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:16px;line-height:1.75;overflow-x:hidden;word-wrap:break-word}
.wrap{width:100%;max-width:76rem;margin:0 auto;padding:0 1.1rem}
a{color:var(--accent);text-underline-offset:.2em}
a:hover{color:var(--accent-2)}
h1{font-size:1.5rem;line-height:1.4;margin:0}
h2{font-size:1.15rem;line-height:1.5;margin:0 0 .5rem}
h3{font-size:1rem;line-height:1.6;margin:1.1rem 0 .4rem}
h4{font-size:.95rem;line-height:1.6;margin:.8rem 0 .3rem;color:var(--fg-dim)}
p{margin:.5rem 0}
ul{margin:.4rem 0;padding-left:1.3em}
li{margin:.25rem 0}
code,.mono,.id{font-family:var(--mono);font-size:.86em}
.skip{position:absolute;left:-9999px}
.skip:focus{left:.5rem;top:.5rem;background:var(--panel);padding:.4rem .7rem;border-radius:6px;z-index:9}

.top{border-bottom:1px solid var(--line);background:var(--panel);padding:1.1rem 0 .2rem}
.top-row{display:flex;gap:.8rem;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.sub{color:var(--fg-dim);font-size:.9rem;margin:.35rem 0 0}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.6rem 0 0;padding:0}
.chip{display:inline-flex;align-items:center;gap:.3rem;background:var(--chip);color:var(--fg-dim);border-radius:999px;padding:.12rem .6rem;font-size:.8rem;line-height:1.7;white-space:nowrap}
.chip.ok{color:var(--ok)} .chip.warn{color:var(--warn)} .chip.bad{color:var(--bad)} .chip.info{color:var(--info)}
.nav{display:flex;flex-wrap:wrap;gap:.1rem .9rem;margin:.7rem 0 .8rem;font-size:.84rem}
.nav a{color:var(--fg-dim);text-decoration:none;border-bottom:1px dotted var(--line-2)}
.nav a:hover{color:var(--accent)}

main{padding:1.2rem 1.1rem 2rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1rem 1.1rem;margin:0 0 1.1rem;box-shadow:var(--shadow)}
.card.hero{border-color:var(--line-2)}
.note{color:var(--fg-dim);font-size:.88rem;margin:.1rem 0 .6rem}
.muted{color:var(--fg-faint)}
.dim{color:var(--fg-dim)}
.small{font-size:.85rem}
.bar{background:var(--panel-2);border-left:3px solid var(--accent);border-radius:6px;padding:.6rem .8rem;font-size:.9rem;color:var(--fg-dim)}
.bar strong{color:var(--fg)}
.keypoints{list-style:none;padding:0;margin:.2rem 0 0}
.keypoints>li{position:relative;padding-left:1.1em;margin:.4rem 0}
.keypoints>li::before{content:"▸";position:absolute;left:0;color:var(--accent);font-size:.85em;top:.1em}
.keypoints>li.last{color:var(--fg-dim);border-top:1px dashed var(--line);margin-top:.7rem;padding-top:.6rem}
.keypoints>li.last::before{content:""}

.scroll{overflow-x:auto;margin:.4rem 0 .2rem;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{padding:.42rem .6rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
thead th{background:var(--panel);position:sticky;top:0;z-index:1;font-weight:600;color:var(--fg-dim);border-bottom:1px solid var(--line-2);white-space:nowrap}
tbody tr:hover{background:var(--panel-2)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.id{font-family:var(--mono);font-size:.8em;color:var(--fg-faint);display:block;font-weight:400}
.wide{min-width:22rem}
.nw{white-space:nowrap}

.cell{text-align:center;font-variant-numeric:tabular-nums;background:var(--panel-2);background:rgb(var(--heat) / calc(.05 + var(--r,0) * .42));white-space:nowrap}
.cell .frac{font-weight:600}
.cell .sub{display:block;font-size:.74rem;color:var(--fg-dim)}
.cell.none{background:transparent;color:var(--fg-faint)}
.cell.zero{box-shadow:inset 0 0 0 1px var(--line-2)}
.cell.unscored{opacity:.72}
.swatch{display:inline-block;width:1.5rem;height:.8rem;vertical-align:-1px;border:1px solid var(--line);border-radius:3px;background:rgb(var(--heat) / calc(.05 + var(--r,0) * .42))}
.legend{font-size:.82rem;color:var(--fg-dim);margin:.5rem 0 0}
.delta{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
.delta.up{background:rgb(var(--heat) / calc(var(--m,0) * .38))}
.delta.down{box-shadow:inset 0 0 0 1px var(--line-2)}
.delta .d{font-weight:600;display:block;font-size:.8rem;color:var(--fg-dim)}

details{border:1px solid var(--line);border-radius:8px;background:var(--panel);margin:.45rem 0}
details[open]{background:var(--panel-2)}
summary{cursor:pointer;padding:.45rem .7rem;font-size:.9rem;list-style-position:inside}
summary:hover{color:var(--accent)}
.detail-body{padding:.2rem .8rem .8rem;background:var(--panel)}
pre{font-family:var(--mono);font-size:.82rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;background:var(--quote);border:1px solid var(--line);border-radius:8px;padding:.7rem .8rem;margin:.4rem 0;max-height:60vh;overflow:auto}
blockquote,.quote{margin:.3rem 0;padding:.35rem .7rem;border-left:3px solid var(--line-2);background:var(--quote);border-radius:0 6px 6px 0;font-size:.88rem;color:var(--fg-dim)}

.grid{display:grid;gap:.9rem;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))}
.col-head{font-size:.9rem;font-weight:600;padding:.3rem 0 .1rem;border-bottom:1px solid var(--line);margin-bottom:.3rem}
.run summary{display:flex;flex-wrap:wrap;gap:.3rem .5rem;align-items:baseline}
.run .rk{font-family:var(--mono);font-weight:600}
.case-block{border-top:1px solid var(--line);padding-top:.9rem;margin-top:1rem}
.case-block:first-of-type{border-top:0;padding-top:0;margin-top:.3rem}

.toolbar{display:none;gap:.5rem;flex-wrap:wrap;align-items:center;margin:.2rem 0 .7rem;font-size:.85rem}
.has-js .toolbar{display:flex}
.js-only{display:none}
.has-js .js-only{display:inline-flex}
button{font:inherit;font-size:.85rem;color:var(--fg-dim);background:var(--panel-2);border:1px solid var(--line);border-radius:999px;padding:.15rem .7rem;cursor:pointer}
button:hover{color:var(--accent);border-color:var(--line-2)}
label.toggle{display:inline-flex;gap:.35rem;align-items:center;color:var(--fg-dim)}
.only-fail .run:not([data-hasfail="1"]){display:none}

.kv{display:grid;grid-template-columns:minmax(6rem,auto) 1fr;gap:.15rem .8rem;font-size:.88rem;margin:.3rem 0}
.kv dt{color:var(--fg-dim)}
.kv dd{margin:0}
.foot{color:var(--fg-faint);font-size:.83rem;border-top:1px solid var(--line);padding-top:1rem;padding-bottom:2.5rem;margin-top:1rem}
.foot p{margin:.35rem 0}
@media (max-width:40rem){
  body{font-size:15px}
  .card{padding:.85rem .8rem;border-radius:8px}
  h1{font-size:1.25rem}
  .kv{grid-template-columns:1fr}
  .kv dt{margin-top:.4rem}
}
@media print{
  .toolbar,.nav,button{display:none!important}
  .card{break-inside:avoid;box-shadow:none}
  details{border:0}
}
`;

const PAGE_JS = `
(function(){
  var d=document.documentElement;
  d.classList.add('has-js');
  try{var t=localStorage.getItem('sg-theme');if(t==='dark'||t==='light')d.setAttribute('data-theme',t);}catch(e){}
  function up(el,sel){while(el&&el.nodeType===1){if(el.matches&&el.matches(sel))return el;el=el.parentElement;}return null;}
  document.addEventListener('click',function(ev){
    var b=up(ev.target,'[data-theme-toggle]');
    if(b){
      var cur=d.getAttribute('data-theme');
      var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next=cur==='dark'?'light':cur==='light'?'dark':(dark?'light':'dark');
      d.setAttribute('data-theme',next);
      try{localStorage.setItem('sg-theme',next);}catch(e){}
      return;
    }
    var x=up(ev.target,'[data-toggle-all]');
    if(x){
      var scope=document.getElementById(x.getAttribute('data-scope'))||document;
      var open=x.getAttribute('data-toggle-all')==='open';
      var list=scope.querySelectorAll('details');
      for(var i=0;i<list.length;i++)list[i].open=open;
    }
  });
  document.addEventListener('change',function(ev){
    var c=ev.target;
    if(c&&c.matches&&c.matches('[data-filter-fail]')){
      var scope=document.getElementById(c.getAttribute('data-scope'));
      if(scope){if(c.checked)scope.classList.add('only-fail');else scope.classList.remove('only-fail');}
    }
  });
})();
`;

// 版塊：內容為空就整塊不出現
function section(id, title, inner, noteHtml) {
  if (!inner) return null;
  return {
    id,
    title,
    html: `<section class="card" id="${esc(id)}">
<h2>${esc(title)}</h2>
${noteHtml ? `<p class="note">${noteHtml}</p>` : ''}
${inner}
</section>`,
  };
}

function table(head, rows, opts = {}) {
  if (!rows.length) return '';
  const cls = opts.cls ? ` class="${esc(opts.cls)}"` : '';
  return `<div class="scroll"><table${cls}>
<thead><tr>${head.map((h) => `<th${h && h.num ? ' class="num"' : ''}>${h && h.html !== undefined ? h.html : h}</th>`).join('')}</tr></thead>
<tbody>
${rows.map((r) => `<tr>${r.map((c) => (isObj(c) && c.td !== undefined ? c.td : `<td>${c === null || c === undefined ? '—' : c}</td>`)).join('')}</tr>`).join('\n')}
</tbody></table></div>`;
}

function chip(text, kind) {
  return `<span class="chip${kind ? ' ' + kind : ''}">${esc(text)}</span>`;
}

function page({ lang = 'zh-Hant', title, h1, subtitleHtml, chipsHtml, sections, footerHtml }) {
  const live = asArr(sections).filter(Boolean);
  const nav = live.length > 1
    ? `<nav class="nav">${live.map((s) => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join('')}</nav>`
    : '';
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">跳到內容</a>
<header class="top">
<div class="wrap">
<div class="top-row">
<h1>${esc(h1 || title)}</h1>
<button class="js-only" type="button" data-theme-toggle aria-label="切換亮色／暗色">◐ 亮暗切換</button>
</div>
${subtitleHtml ? `<p class="sub">${subtitleHtml}</p>` : ''}
${chipsHtml ? `<p class="chips">${chipsHtml}</p>` : ''}
${nav}
</div>
</header>
<main id="main" class="wrap">
${live.map((s) => s.html).join('\n')}
</main>
<footer class="wrap foot">
${footerHtml || ''}
</footer>
<script>${PAGE_JS}</script>
</body>
</html>
`;
}

// ---------- 讀資料的共用推導 ----------
function armsOf(r) {
  const listed = asArr(r.arms).map(txt).filter(Boolean);
  const set = new Set(listed);
  for (const k of Object.keys(asObj(r.totals))) set.add(k);
  for (const k of Object.keys(asObj(r.cost))) set.add(k);
  for (const c of asArr(r.cases)) for (const k of Object.keys(asObj(asObj(c).arms))) set.add(k);
  for (const x of Object.values(asObj(r.assertions))) for (const k of Object.keys(asObj(asObj(x).arms))) set.add(k);
  for (const run of asArr(r.runs)) if (isObj(run) && nz(run.arm)) set.add(txt(run.arm));
  return [...set];
}

// 敏感度：報告有就用報告的；沒有就用兩組通過數當場算（公式與引擎相同），並標明是推得的
function sensitivityOf(r, arms) {
  const s = asObj(r.sensitivity);
  if (num(s.delta) !== null) {
    return {
      delta: num(s.delta),
      flipsToErase: num(s.flipsToErase),
      flipsToReverse: num(s.flipsToReverse),
      sameDenominator: s.sameDenominator !== false,
      note: txt(s.note),
      derived: false,
    };
  }
  const tA = asObj(asObj(r.totals)[arms[0]]), tB = asObj(asObj(r.totals)[arms[1]]);
  if (num(tA.pass) === null || num(tB.pass) === null) return null;
  const d = num(tA.pass) - num(tB.pass);
  const same = num(tA.total) !== null && num(tA.total) === num(tB.total);
  return { delta: d, flipsToErase: same ? Math.abs(d) : null, flipsToReverse: same ? Math.abs(d) + 1 : null, sameDenominator: same, note: same ? '' : '兩組總格數不同（有 run 沒過前置檢查而不進計分，或有前置作廢／失敗），不做翻格句', derived: true };
}

function heatCell(x, opts = {}) {
  const o = asObj(x);
  const t = num(o.total), p = num(o.pass);
  if (t === null || p === null) return `<td class="cell none">—</td>`;
  const rate = t > 0 ? p / t : 0;
  const fails = t - p;
  const cls = ['cell'];
  if (t > 0 && p === 0) cls.push('zero');
  if (opts.unscored) cls.push('unscored');
  return `<td class="${cls.join(' ')}" style="--r:${rate.toFixed(3)}"><span class="frac">${esc(p)}/${esc(t)}</span>${
    fails > 0 ? `<span class="sub">不通過 ${esc(fails)}</span>` : ''
  }</td>`;
}

function passFrac(x) {
  const o = asObj(x);
  if (num(o.pass) === null || num(o.total) === null) return null;
  return `${o.pass}/${o.total}`;
}

// ============================================================
// renderReportHtml — 一次量測的報告
// ============================================================
export function renderReportHtml(report, opts = {}) {
  const r = asObj(report);
  const arms = armsOf(r);
  const A = arms[0], B = arms[1];
  const sens = sensitivityOf(r, arms);
  const name = nz(txt(r.name)) || '（未命名）';
  const title = txt(opts.title || `skill-gauge 報告 — ${name}`);
  const cell = asObj(r.matrixCell);
  const cond = asObj(r.conditions);

  const chips = [];
  if (nz(r.generatedAt)) chips.push(chip(`產生時間 ${txt(r.generatedAt)}`));
  if (nz(cell.executorModel)) chips.push(chip(`矩陣格：${txt(cell.executorModel)}${nz(cell.effort) ? ` ／ effort ${txt(cell.effort)}` : ''}`, 'info'));
  else if (nz(cond.executorModel)) chips.push(chip(`執行模型 ${txt(cond.executorModel)}${nz(cond.executorEffort) ? ` ／ effort ${txt(cond.executorEffort)}` : ''}`));
  if (num(r.runsPlanned) !== null) chips.push(chip(`每題每組計畫跑 ${r.runsPlanned} 次`));
  if (arms.length) chips.push(chip(`${arms.length} 組：${arms.map(armName).join('、')}`));
  if (nz(cell.slug)) chips.push(chip(`格 ${txt(cell.slug)}`));
  if (nz(r.engine)) chips.push(chip(`量測引擎 ${txt(r.engine)}`));

  const sections = [
    secDecisionFirst(r),
    secSummary(r),
    secKeyPoints(r, arms, sens),
    secSayNotSay(),
    secConditions(r, arms),
    secTotals(r, arms, sens),
    secAssertionGrid(r, arms),
    secBenefit(r),
    secCases(r, arms),
    secPressure(r, arms),
    secTrigger(r),
    secFootprint(r),
    secCost(r, arms),
    secFlags(r),
    secNextSteps(r),
    secOutputs(r, arms),
  ];

  const condBits = [
    nz(cond.executorModel) ? `執行模型 ${esc(txt(cond.executorModel))}` : null,
    nz(cond.executorEffort) ? `effort ${esc(txt(cond.executorEffort))}` : null,
    nz(cond.judgeModel) ? `評分模型 ${esc(txt(cond.judgeModel))}` : null,
    nz(cond.platform) ? esc(txt(cond.platform)) : null,
  ].filter(Boolean);
  const footer = [
    `<p>這一頁由 skill-gauge 的 <code>render.mjs</code> 直接從 <code>report.json</code> 產生：沒有連任何外部資源，可以離線開、也可以整份寄給別人。</p>`,
    `<p>頁面上的每個數字都只描述這一次的條件${condBits.length ? `（${condBits.join('、')}）` : ''}。換一個模型、換一組題目，數字就不是這樣。</p>`,
    `<p>可說明與無法說明的最終措辭，以 pre-registration 裡寫死的那一段為準；有旗標的地方，結論要跟旗標一起講。</p>`,
  ].join('\n');

  return page({ title, h1: title, chipsHtml: chips.join(''), sections, footerHtml: footer });
}

// 1. 先看這裡
function nextHtml(sm) {
  const nk = asObj(sm.nextByKind);
  if (!nk.question && !nk.skill) return asArr(sm.next).length ? `<h3>該怎麼改</h3><ul class="keypoints">${asArr(sm.next).map((x) => `<li>${esc(txt(x))}</li>`).join('')}</ul>` : '';
  const q = asArr(nk.question).map((x) => String(x).replace(/^改題：|^停案或退役：/, '')), s = asArr(nk.skill).map((x) => String(x).replace(/^改 skill(（[^）]*）)?：/, ''));
  const rest = [...asArr(nk.none), ...asArr(nk.other)];
  return `<h3>該怎麼改——兩件事分開看</h3><ul class="keypoints"><li><strong>改題目</strong>（測量本身的題目與檢查）：${q.length ? esc(q.join('；')) : '這次沒有'}</li><li><strong>改 skill 本身</strong>：${s.length ? esc(s.join('；')) : '這次沒有要改 skill 的建議'}</li>${rest.map((x) => `<li>${esc(txt(x))}</li>`).join('')}</ul>`;
}
// -1. 決策摘要（真正的第一頁；report.decisionFirst 由引擎產生的四句＋邊界行，沒有就不顯示）
function secDecisionFirst(r) {
  const lines = asArr(r.decisionFirst);
  if (!lines.length) return null;
  return section(
    'decision-first',
    '決策摘要',
    `<ul class="keypoints">${lines.map((l) => `<li>${esc(txt(l))}</li>`).join('')}</ul>`,
    '每一句都是引擎從 report.json 算出來的，不是 AI 現場寫的；下面各節是同一份資料的深究版。'
  );
}
// 0. 原始摘要（深究用；report.summary 由引擎產生，沒有就不顯示）——給人看的第一頁是上面的決策摘要，這一段是它的推導細節
function secSummary(r) {
  const sm = asObj(r.summary);
  if (!nz(sm.helped)) return null;
  const list = (title, arr) => (asArr(arr).length ? `<h3>${esc(title)}</h3><ul class="keypoints">${asArr(arr).map((x) => `<li>${esc(txt(x))}</li>`).join('')}</ul>` : '');
  const wins = asArr(sm.winsPlain ?? sm.wins), losses = asArr(sm.lossesPlain ?? sm.losses);
  const inline = (title, arr) => (arr.length ? `<p><strong>${esc(title)}：</strong>${arr.map((x) => esc(txt(x))).join('；')}</p>` : '');
  return section('summary', '原始摘要（深究用）',
    `<p class="bar" style="font-size:1.05rem;line-height:1.9"><strong>有沒有幫上忙？</strong> ${esc(txt(sm.helped))}</p>
${nz(sm.needFix) ? `<p class="bar" style="font-size:1.05rem;line-height:1.9"><strong>需不需要改進？</strong> ${esc(txt(sm.needFix))}</p>` : ''}
${nextHtml(sm)}${inline('優點在哪', wins)}${inline('缺點在哪／要注意', losses)}${list('這次的限制', sm.limits)}
${asArr(sm.askAI).length ? `<p><strong>跟 AI 討論這份報告時，可以這樣問：</strong>${asArr(sm.askAI).map((x) => esc(txt(x))).join(' ')}</p>` : ''}
<p class="note">優缺點每條有沒有過幾次，在下面「逐條檢查項」那張表；決策摘要（上面）才是轉述給別人用的那一頁，這裡是深究細節。</p>`);
}

function secKeyPoints(r, arms, sens) {
  const A = arms[0], B = arms[1];
  const L = [];
  const bl = r.baseline ? asObj(r.baseline) : null;
  const isNew = isNewReportShape(r); // 舊報告（1.1.x）不套「場景全對」措辭——那個口徑當初根本不存在（v1.5-4）

  if (bl) {
    const v = txt(bl.verdict);
    const tail =
      v === 'STOP'
        ? `<strong>已停。</strong>${esc(txt(bl.note))}`
        : v === 'CONTINUE'
        ? `沒全過（${asArr(bl.weakAssertions).map((x) => `<code>${esc(txt(x))}</code>`).join('、') || '未列出是哪幾條'}），繼續跑帶 skill 那組。`
        : `沒有有效資料。${esc(txt(bl.note))}`;
    L.push(`停案規則：不帶 skill 那組先跑完 ${esc(fmtOr(bl.validRuns))} 次有效 run——${tail}`);
  }

  const totals = asObj(r.totals);
  const tA = A ? asObj(totals[A]) : {}, tB = B ? asObj(totals[B]) : {};
  const hasA = passFrac(tA), hasB = passFrac(tB);
  if (hasA && hasB) {
    let s = `計分的檢查項：${esc(armSay(A))}通過 ${esc(hasA)}，${esc(armSay(B))}通過 ${esc(hasB)}。`;
    if (sens && sens.sameDenominator) {
      s += `差 ${esc(sens.delta)} 格；只要翻 ${esc(dash(sens.flipsToReverse))} 格結論就反過來`;
      if (Math.abs(sens.delta) <= 2) s += '——這個差距很小，不要當成定論';
      s += '（翻格數是脆弱度計數，不是統計檢定）';
      s += sens.derived ? '（差距與翻幾格由兩組通過數當場推得）。' : '。';
    } else if (sens) {
      s += `差 ${esc(sens.delta)} 格，但兩組總格數不同（有 run 沒過前置檢查而不進計分，或有前置作廢／失敗），不做「翻幾格反轉」句；計分格這一層先擱著${isNew ? '，看決策摘要的場景全對率' : ''}。`;
    }
    L.push(s);
  } else if (hasA || hasB) {
    const only = hasA ? A : B;
    L.push(
      `只有${esc(armSay(only))}這一組有計分格：通過 ${esc(hasA || hasB)}${r.baseline ? '' : '（另一組還沒跑，或整組沒過前置檢查／全數前置作廢）'}。`
    );
  } else {
    L.push(`兩組都還沒有可比的計分格（有 run 沒過前置檢查而不進計分，或有前置作廢／失敗）${isNew ? '——場景全對率看決策摘要那一行' : ''}。`);
  }

  for (const pl of asArr(r.placebo)) {
    const p = asObj(pl);
    const note = nz(txt(p.note))
      ? esc(txt(p.note))
      : `${esc(armSay(p.arm))}比不帶多 ${esc(fmtOr(p.reminderEffect))} 格（拆帳給「有被指示」）；完整 skill 比它多 ${esc(fmtOr(p.contentEffect))} 格（拆帳給「內容」）——這是描述性拆帳，不是因果`;
    L.push(`一句提醒（第三組） vs 內容：${note}。`);
  }

  const flags = asArr(r.flags).map(txt);
  const count = (p) => flags.filter((f) => f.startsWith(p)).length;
  const zero = count('零鑑別'), hurt = count('帶 skill 反而'), sim = count('同格'), bias = count('前置檢查沒過集中') + count('前置檢查偏向');
  const never = count('恆不過'), noload = count('skill 沒被載入'), negfire = count('負向對照題誤觸發'), nofoot = count('看不出足跡');
  if (zero) L.push(`有 ${esc(zero)} 條檢查項兩組全過：這些項目測不出 skill 的差別（可能模型本來就會，或題目太鬆）。`);
  if (never) L.push(`有 ${esc(never)} 條檢查項兩組全不過：判斷標準可能太嚴，或量到了別的東西。`);
  if (hurt) L.push(`有 ${esc(hurt)} 條檢查項帶 skill 反而較差，逐條看下面的表。`);
  if (sim) L.push(`有 ${esc(sim)} 個格子的同格 run 高度相似，有效樣本比次數少。`);
  if (bias) L.push('前置檢查沒過集中在某一組：先去「逐份看產出」分辨是前置檢查含 skill 專屬格式（兩組不對等，先修檢查），還是那一組沒交付（拒答、只反問——這本身就是結果）。');
  if (noload) L.push(`有 ${esc(noload)} 條旗標指出 skill 沒被載入——那幾次量到的不是「帶 skill」。`);
  if (negfire) L.push(`負向對照題誤觸發：不該出手的場景也出手了，看下面的足跡段。`);
  if (nofoot) L.push('看不出足跡：帶 skill 那組沒有留下呼叫或讀取的痕跡，先確認 skill 真的有進場。');
  const known = zero + never + hurt + sim + bias + noload + negfire + nofoot;
  if (flags.length > known) L.push(`另有 ${esc(flags.length - known)} 條旗標，見下面的旗標清單。`);

  const fp = asObj(r.footprint);
  if (num(fp.known) !== null && num(fp.known) > 0) {
    const cases = asArr(fp.cases)
      .map((f) => `${esc(txt(f.case))} ${esc(fmtRatio(f.crossArmSimilarity))}（同組內 ${esc(fmtRatio(f.withinArmSimilarity))}）`)
      .join('、');
    L.push(
      `有沒有在做事（足跡）：帶 skill 那組（負向對照題除外）${esc(fp.known)} 次裡 ${esc(fmtOr(fp.fired))} 次偵測到 skill 被呼叫或讀取` +
        (num(fp.negativeKnown) ? `；負向對照題 ${esc(fp.negativeKnown)} 次裡 ${esc(fmtOr(fp.negativeFired))} 次誤觸發` : '') +
        (cases ? `；兩組產出相似度 ${cases}——數字越接近同組內，skill 越沒改變產出` : '') +
        '。'
    );
  }

  const cost = asObj(r.cost);
  const cA = asObj(cost[A]), cB = asObj(cost[B]);
  if (num(cA.medianDurationS) !== null && num(cB.medianDurationS) !== null) {
    L.push(
      `成本：${esc(armSay(A))}每次約 ${esc(num(cA.medianDurationS).toFixed(0))} 秒／${esc(fmtOr(cA.medianOutputTokens))} 輸出 token；` +
        `${esc(armSay(B))}約 ${esc(num(cB.medianDurationS).toFixed(0))} 秒／${esc(fmtOr(cB.medianOutputTokens))}。`
    );
  }

  const tg = asObj(r.trigger);
  if (r.trigger) {
    const sh = asObj(tg.should), sn = asObj(tg.shouldNot);
    L.push(
      `觸發：該觸發時 ${esc(fmtOr(sh.fired))}/${esc(fmtOr(sh.n))} 次有觸發；不該觸發時 ${esc(fmtOr(sn.fired))}/${esc(fmtOr(sn.n))} 次誤觸發。`
    );
  }

  const pr = asObj(r.pressure);
  const psum = asObj(pr.summary);
  if (Object.keys(psum).length) {
    const parts = Object.entries(psum)
      .map(([a, v]) => (num(asObj(v).total) ? `${esc(armSay(a))}${esc(fmtOr(asObj(v).held))}/${esc(fmtOr(asObj(v).total))}` : `${esc(armSay(a))}未跑`))
      .join('，');
    const cap = asArr(pr.capture);
    const over = cap.filter((c) => txt(asObj(c).direction) === 'overapplied').length;
    L.push(
      `壓力測試：被推著違規時守住的次數——${parts}。留下 ${esc(cap.length)} 筆合理化逐字擷取` +
        (over ? `，其中 ${esc(over)} 筆是過度套用（不該套的情境也照套）` : '') +
        '。'
    );
  }

  const inv = asArr(r.invalidRuns), hf = asArr(r.harnessFailures);
  if (inv.length || hf.length) {
    L.push(`有 ${esc(inv.length)} 次沒過前置檢查（有效但未成功，不進計分、不用補跑）、${esc(hf.length)} 次執行或評分失敗（前置作廢，要補跑）。`);
  }

  const hist = asObj(r.history);
  if (num(hist.entries) !== null) {
    const last = asObj(hist.last);
    L.push(
      `先前紀錄：這份題目已經量過 ${esc(hist.entries)} 次` +
        (nz(last.at) ? `，上一次在 ${esc(txt(last.at))}` : '') +
        (nz(last.verdict) ? `（停案判定 ${esc(txt(last.verdict))}）` : '') +
        '；要比較退步與進步，用 compare 對兩份 report.json，不要用眼睛比。'
    );
  }

  const items = L.map((s) => `<li>${s}</li>`).join('\n');
  const lastLine = `<li class="last">這些都是描述，不是因果；能不能說「skill 有用」，看 pre-registration 寫死的「可說明／無法說明」。</li>`;
  return section('key', '先看這裡', `<ul class="keypoints">\n${items}\n${lastLine}\n</ul>`, '描述性，只限這次條件。');
}

// 2. 可說明／無法說明
function secSayNotSay() {
  return section(
    'saynotsay',
    '可說明／無法說明',
    `<p class="bar"><strong>可說明：</strong>上面這些描述性的數字，而且只限這一次的條件。<br>
<strong>無法說明：</strong>因果通則、外推到這組題目以外的任務、跨模型比較。<br>
最終措辭以 pre-registration 寫死的「可說明／無法說明」為準；有旗標的地方，結論要跟著旗標一起講。</p>`
  );
}

// 3. 條件
function secConditions(r, arms) {
  const c = asObj(r.conditions);
  const cost = asObj(r.cost);
  const rows = [];
  const actual = arms
    .map((a) => `${esc(armName(a))}：${esc(asArr(asObj(cost[a]).models).map(txt).join('、') || '?')}`)
    .join('；');
  rows.push(['執行模型（設定／實際）', `${esc(nz(txt(c.executorModel)) || '（未記錄）')} ／ ${actual || '—'}`]);
  if (nz(c.executorEffort)) rows.push(['effort（推理檔位）', `<code>${esc(txt(c.executorEffort))}</code>`]);
  rows.push(['評分模型', esc(nz(txt(c.judgeModel)) || '?')]);
  const iso = asArr(c.isolation).map((x) => `<code>${esc(txt(x))}</code>`).join('、');
  rows.push(['隔離開關', iso || '<span class="muted">未記錄</span>']);
  rows.push([
    '平台',
    `${esc(nz(txt(c.platform)) || '—')}；node ${esc(nz(txt(c.node)) || '?')}；claude ${esc(nz(txt(c.claudeVersion)) || '?')}`,
  ]);

  const isolation = asObj(r.isolation);
  rows.push([
    '已知答案檢查',
    r.isolation
      ? asArr(isolation.items)
          .map((i) => `${esc(txt(asObj(i).canary))}：<strong>${esc(txt(asObj(i).verdict))}</strong>`)
          .join('；') || '<span class="muted">沒有項目</span>'
      : '<span class="muted">未跑</span>',
  ]);

  const g = asObj(r.graderSelfCheck);
  rows.push([
    '評分者自證（已知好壞各一份）',
    r.graderSelfCheck
      ? `<strong>${g.ok ? 'PASS' : 'FAIL'}</strong>（明顯通過的判 ${esc(txt(g.good))}、明顯不通過的判 ${esc(txt(g.bad))}）`
      : '<span class="muted">未跑</span>',
  ]);

  const lock = asObj(r.lock);
  rows.push([
    '輸入鎖定（預先登錄＋skill＋題目）',
    r.lock
      ? lock.ok
        ? `一致${nz(lock.lockedAt) ? `（鎖定於 ${esc(txt(lock.lockedAt))}）` : ''}`
        : `<strong>不一致或未鎖：</strong>${esc(nz(txt(lock.reason)) || asArr(lock.diffs).map(txt).join('；') || '未說明')}`
      : '<span class="muted">未記錄</span>',
  ]);

  const mc = asObj(r.matrixCell);
  if (Object.keys(mc).length) {
    rows.push([
      '這份報告在矩陣裡的位置',
      `${esc(nz(txt(mc.executorModel)) || '?')}${nz(mc.effort) ? ` ／ effort ${esc(txt(mc.effort))}` : ''}${nz(mc.slug) ? `（<code>${esc(txt(mc.slug))}</code>）` : ''}`,
    ]);
  }
  const hist = asObj(r.history);
  if (num(hist.entries) !== null) {
    const last = asObj(hist.last);
    const tot = asObj(last.totals);
    const totStr = Object.entries(tot)
      .map(([a, v]) => `${esc(armSay(a))}${esc(dash(passFrac(v)))}`)
      .join('，');
    rows.push([
      '先前紀錄',
      `共 ${esc(hist.entries)} 筆${nz(last.at) ? `；上次 ${esc(txt(last.at))}` : ''}${totStr ? `：${totStr}` : ''}${nz(last.verdict) ? `；停案判定 ${esc(txt(last.verdict))}` : ''}`,
    ]);
  }

  let inner = table(['項目', '值'], rows.map(([k, v]) => [esc(k), v]));

  // 已知答案檢查的原始回覆：留給想自己核對的人
  const items = asArr(isolation.items);
  if (items.length) {
    const KEY = {
      canary: '檢查項',
      verdict: '判定',
      sandbox: '沙箱目錄',
      withSandbox: '帶 skill 的沙箱',
      withoutSandbox: '不帶的沙箱',
      noflags: '不加隔離開關時的回答',
      flags: '加了隔離開關的回答',
      with: '帶 skill 的回答',
      without: '不帶 skill 的回答',
    };
    const body = items
      .map((i) => {
        const o = asObj(i);
        const dl = Object.entries(o)
          .filter(([, v]) => nz(v) !== null && typeof v !== 'object')
          .map(([k, v]) => `<dt>${esc(KEY[k] || k)}</dt><dd>${/\n/.test(txt(v)) ? `<pre>${esc(txt(v))}</pre>` : esc(txt(v))}</dd>`)
          .join('');
        return `<h4>${esc(txt(o.canary) || '檢查項')}</h4><dl class="kv">${dl}</dl>`;
      })
      .join('\n');
    inner += `<details><summary>已知答案檢查的原始回覆（自己核對用）</summary><div class="detail-body">${body}</div></details>`;
    if (nz(isolation.root)) inner += `<p class="note">隔離根目錄：<code>${esc(txt(isolation.root))}</code>${asArr(isolation.ancestors).length ? `；上層有 .claude/：${asArr(isolation.ancestors).map((x) => `<code>${esc(txt(x))}</code>`).join('、')}` : ''}</p>`;
  }
  return section('conditions', '條件', inner, '換掉任何一列，數字就不能跟這一份比。');
}

// 4. 總表＋停案規則＋第三組
function secTotals(r, arms, sens) {
  const totals = asObj(r.totals);
  const rows = arms.map((a) => [
    armHeadHtml(a),
    { td: `<td class="num"><strong>${esc(dash(passFrac(totals[a])))}</strong></td>` },
  ]);
  let inner = table(['組', { html: '通過／總格數', num: true }], rows);
  if (!inner) inner = '<p class="muted">沒有可比的計分格。</p>';

  if (sens && arms.length > 1) {
    inner += sens.sameDenominator === false ? `<p class="note">差距（${esc(armName(arms[0]))} − ${esc(armName(arms[1]))}）＝ <strong>${esc(sens.delta)}</strong>，但兩組總格數不同，不做翻格句。${esc(sens.note)}</p>` : `<p class="note">差距（${esc(armName(arms[0]))} − ${esc(armName(arms[1]))}）＝ <strong>${esc(sens.delta)}</strong>；抹平要翻 ${esc(dash(sens.flipsToErase))} 格、反轉要翻 ${esc(dash(sens.flipsToReverse))} 格。${
      sens.derived ? '（這兩個數字是用兩組通過數當場推得，報告本身沒有帶敏感度欄位。）' : esc(sens.note)
    }</p>`;
  }

  const bl = r.baseline ? asObj(r.baseline) : null;
  if (bl) {
    const v = txt(bl.verdict);
    const perRows = Object.entries(asObj(bl.perAssertion)).map(([id, x]) => [
      `<code>${esc(id)}</code>`,
      { td: heatCell(x) },
    ]);
    inner += `<h3>停案規則（不帶 skill 那組先跑）</h3>
<p>判定：<strong>${esc(BASELINE_VERDICT[v] || v || '—')}</strong>${v ? `（<code>${esc(v)}</code>）` : ''}——${esc(txt(bl.note))}</p>
<p class="note">有效 run ${esc(fmtOr(bl.validRuns))} 次；沒過前置檢查 ${esc(fmtOr(bl.invalidRuns))} 次；執行或評分失敗（前置作廢，要補跑）${esc(fmtOr(bl.harnessFailures))} 次。${
      asArr(bl.weakAssertions).length ? `沒全過的檢查項：${asArr(bl.weakAssertions).map((x) => `<code>${esc(txt(x))}</code>`).join('、')}。` : ''
    }</p>
${table(['檢查項', { html: '基準組通過／總格', num: true }], perRows)}`;
  }

  const placebo = asArr(r.placebo);
  if (placebo.length) {
    const rows2 = placebo.map((p) => {
      const o = asObj(p);
      return [
        armHeadHtml(o.arm),
        `<td class="num">${esc(dash(nz(txt(o.pass)) || passFrac(asObj(r.totals)[txt(o.arm)])))}</td>`,
        `<td class="num">${esc(fmtOr(o.reminderEffect))}</td>`,
        `<td class="num">${esc(fmtOr(o.contentEffect))}</td>`,
        `<td class="num">${esc(fmtOr(o.totalEffect))}</td>`,
      ].map((x, i) => (i === 0 ? x : { td: x }));
    });
    inner += `<h3>有被指示 vs 指示的內容（第三組）</h3>
<p class="note">第三組只拿到一句提醒，不給 skill 的內容。「有被指示」那一欄是它比不帶多的格數，「內容」那一欄是完整 skill 比它多的格數——描述性拆帳、不是因果；各只差幾格時，同樣一兩格就翻。</p>
${table(
  ['組', { html: '通過／總格', num: true }, { html: '比不帶多（拆帳給有被指示）', num: true }, { html: '完整 skill 比它多（拆帳給內容）', num: true }, { html: '合計差', num: true }],
  rows2
)}`;
  }

  return section('totals', '總表', inner, '只計事實檢查與判斷檢查；前置檢查不計分、取向觀察不計分。');
}

// 5. 逐條檢查項 × 組
function secAssertionGrid(r, arms) {
  const entries = Object.entries(asObj(r.assertions));
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const fa = FAMILY_ORDER[asObj(a[1]).family] ?? 9, fb = FAMILY_ORDER[asObj(b[1]).family] ?? 9;
    return fa - fb;
  });
  const rows = entries.map(([id, x]) => {
    const o = asObj(x);
    const unscored = FAMILY_UNSCORED.has(txt(o.family));
    const famCell = `${esc(familyLabel(o.family))}${unscored ? '<span class="id">不計分</span>' : ''}`;
    const idCell = `<div class="wide"><code>${esc(id)}</code>${assertionDispHtml(o)}</div>`;
    return [idCell, famCell, ...arms.map((a) => ({ td: heatCell(asObj(o.arms)[a], { unscored }) }))];
  });
  const inner =
    table(['檢查項', '類別', ...arms.map((a) => ({ html: armHeadHtml(a), num: true }))], rows) +
    `<p class="legend">底色深淺＝通過比例：<span class="swatch" style="--r:0"></span> 0 ／ <span class="swatch" style="--r:.5"></span> 一半 ／ <span class="swatch" style="--r:1"></span> 全過。全不過的格子加了外框，格內也寫出不通過幾次。</p>`;
  return section(
    'assertions',
    '逐條檢查項 × 組',
    inner,
    '兩組都全過的檢查項（零鑑別）測不出差別；兩組都全不過的（恆不過）多半是判斷標準太嚴，或量到了別的東西。'
  );
}

// 5b. 環節效益表（第二層診斷）：逐一條預期檢查看帶／不帶的通過率差，四分類
const BENEFIT_CHIP = { negative: 'bad', bothLow: 'warn', bothHigh: 'warn', middling: '', positive: '' };
function secBenefit(r) {
  const b = asObj(r.benefit);
  const rows = asArr(b.rows);
  if (!rows.length) return null;
  const cellOf = (x) => { const o = asObj(x); return `${esc(fmtOr(o.pass))}/${esc(fmtOr(o.judged))}（${esc(Math.round((num(o.rate) || 0) * 100))}%）`; };
  const trs = rows.map((x) => {
    const o = asObj(x);
    const d = num(o.diff) || 0;
    return [
      `<div class="wide"><code>${esc(txt(o.id))}</code><div>${esc(txt(o.label))}</div></div>`,
      esc(familyLabel(o.family)),
      { td: `<td class="num">${cellOf(o.with)}</td>` },
      { td: `<td class="num">${cellOf(o.without)}</td>` },
      { td: `<td class="num">${esc((d > 0 ? '+' : '') + Math.round(d * 100))}%</td>` },
      chip(txt(o.kindZh), BENEFIT_CHIP[txt(o.kind)] ?? '') + (o.populationMismatch ? ` ${chip(txt(o.populationMismatchLabel), 'warn')}` : ''),
    ];
  });
  const inner = table(['檢查項', '類別', { html: '帶 skill', num: true }, { html: '不帶', num: true }, { html: '差', num: true }, '判讀'], trs) +
    `<ul class="keypoints"><li>分類先看有沒有實質差（同母體＝通過次數差 ≥1 次；母體不等＝比率差過門檻並標「母體不等」），沒有實質差才看水準。</li>` +
    `<li><strong>負效益（帶 skill 反而差）</strong>＝幫倒忙的具體位置，改 skill 時最優先。</li>` +
    `<li><strong>正效益</strong>＝帶 skill 明顯多過，值得延伸的地方。</li>` +
    `<li><strong>兩邊都低</strong>＝出題問題或能力缺口，先改題目。</li>` +
    `<li><strong>兩邊都高</strong>＝這個環節 skill 沒貢獻；如果它是主賣點，就是「沒用」的警訊。</li>` +
    `<li><strong>中段（沒有實質差）</strong>＝兩組差不多，也看不出水準特別高或低。</li></ul>` +
    `<p class="note">${esc(txt(b.note))}${nz(asObj(b.thresholds).note) ? ' 分類門檻：' + esc(txt(asObj(b.thresholds).note)) : ''}${num(b.skipped) ? ` 另有 ${esc(fmtOr(b.skipped))} 條檢查項因為有一組沒有明確判定，沒進這張表。` : ''}</p>`;
  return section('benefit', '環節效益表（哪個環節幫上忙、哪個環節幫倒忙）', inner,
    b.thin === true ? '每格樣本薄——這張表當線索，不當定論。' : '逐條檢查項的通過率差；個位數次數本來就會晃，配著旗標一起讀。');
}

// 6. 逐題
function secCases(r, arms) {
  const cases = asArr(r.cases);
  if (!cases.length) return null;
  const anyFired = cases.some((c) => arms.some((a) => num(asObj(asObj(asObj(c).arms)[a]).skillFiredKnown) !== null));
  const rows = cases.map((c) => {
    const o = asObj(c);
    const cells = arms.map((a) => {
      const x = asObj(asObj(o.arms)[a]);
      const frac = passFrac(x);
      if (!frac) return { td: '<td class="cell none">—</td>' };
      const extra = [
        `有效 ${esc(fmtOr(x.validRuns))}`,
        num(x.invalidRuns) ? `前置檢查沒過 ${esc(x.invalidRuns)}` : null,
        num(x.failures) ? `前置作廢 ${esc(x.failures)}` : null,
      ].filter(Boolean).join('、');
      const t = num(x.total) || 0, p = num(x.pass) || 0;
      const rate = t > 0 ? p / t : 0;
      return {
        td: `<td class="cell" style="--r:${rate.toFixed(3)}"><span class="frac">${esc(p)}/${esc(t)}</span><span class="sub">${extra}</span></td>`,
      };
    });
    const fired = anyFired
      ? arms
          .map((a) => {
            const x = asObj(asObj(o.arms)[a]);
            if (num(x.skillFiredKnown) === null) return null;
            return `${esc(armSay(a))}${esc(fmtOr(x.skillFired))}/${esc(fmtOr(x.skillFiredKnown))}`;
          })
          .filter(Boolean)
          .join('<br>')
      : null;
    const row = [
      `<code>${esc(txt(o.id))}</code>`,
      esc(caseTypeLabel(txt(o.type))) || '—',
      ...cells,
    ];
    if (anyFired) row.push(fired || '—');
    return row;
  });
  const head = ['題', '型', ...arms.map((a) => ({ html: armHeadHtml(a), num: true }))];
  if (anyFired) head.push('偵測到 skill 載入／可判定次數');
  return section('cases', '逐題', table(head, rows), '括號裡是有效 run 數；「前置檢查沒過」是有效但未成功的結果（不進計分，不用補跑），「前置作廢」才是執行或評分失敗、要補跑的。');
}

// 7. 壓力測試
function secPressure(r, arms) {
  const pr = asObj(r.pressure);
  const scenarios = asArr(pr.scenarios);
  const capture = asArr(pr.capture);
  const summary = asObj(pr.summary);
  if (!scenarios.length && !capture.length && !Object.keys(summary).length) return null;

  let inner = '';
  if (Object.keys(summary).length) {
    const rows = Object.entries(summary).map(([a, v]) => {
      const o = asObj(v);
      return [armHeadHtml(a), { td: `<td class="num">${num(o.total) ? `${esc(fmtOr(o.held))}/${esc(fmtOr(o.total))}` : '未跑'}</td>` }];
    });
    inner += table(['組', { html: '守住／總次數', num: true }], rows);
  }

  if (scenarios.length) {
    const rows = scenarios.map((s) => {
      const o = asObj(s);
      const per = arms.map((a) => {
        const x = asObj(asObj(o.arms)[a]);
        if (!Object.keys(x).length) return { td: '<td class="cell none">—</td>' };
        const held = num(x.held) ?? 0, totalAll = num(x.total);
        if (!totalAll) return { td: '<td class="cell none">未跑</td>' };
        const total = Math.max(0, totalAll - (num(x.inconclusive) || 0)); // 分母＝有效次數（判不出來的另列）
        const rate = total ? held / total : 0;
        const extra = [
          num(x.violated) ? `違規 ${esc(x.violated)}` : null,
          num(x.overapplied) ? `過度套用 ${esc(x.overapplied)}` : null,
          num(x.refused) ? `拒做／沒交付 ${esc(x.refused)}` : null,
          num(x.inconclusive) ? `判不出來 ${esc(x.inconclusive)}` : null,
          num(x.citedSkill) ? `引用 skill ${esc(x.citedSkill)} 次` : null,
        ].filter(Boolean).join('、');
        return {
          td: `<td class="cell" style="--r:${rate.toFixed(3)}"><span class="frac">${esc(held)}/${esc(dash(total))}</span>${extra ? `<span class="sub">${extra}</span>` : ''}</td>`,
        };
      });
      return [
        `<code>${esc(txt(o.case))}</code>`,
        `<div class="wide">${esc(txt(o.rule))}</div>`,
        esc(EXPECTED_BEHAVIOR[txt(o.expectedBehavior)] || txt(o.expectedBehavior)) || '—',
        asArr(o.pressures).map((p) => chip(txt(p))).join('') || '—',
        ...per,
      ];
    });
    inner += `<h3>情境</h3>${table(
      ['情境', '要守的規則', '預期行為', '施加的壓力', ...arms.map((a) => ({ html: armHeadHtml(a), num: true }))],
      rows
    )}`;
  }

  const renderCapture = (list) =>
    list
      .map((c) => {
        const o = asObj(c);
        const sid = txt(o.scenario_id ?? o.scenarioId ?? o.case);
        const chosen = txt(o.chosen_option ?? o.chosenOption);
        const expected = txt(o.expected_option ?? o.expectedOption);
        const rats = asArr(o.rationalizations ?? o.rationalisations).map(txt).filter(Boolean);
        const verb = asArr(o.rationalizations_verbatim ?? o.rationalizationsVerbatim);
        const worked = asArr(o.pressures_that_worked ?? o.pressuresThatWorked).map(txt).filter(Boolean);
        const dir = txt(o.direction);
        return `<details><summary><span class="rk">${esc(sid)}</span> ${esc(armName(o.arm))} · run ${esc(txt(o.run))} ${chip(
          dir === 'overapplied' ? '過度套用' : dir === 'violated' ? '違規' : dir === 'refused' ? '拒做／沒交付' : dir || '—',
          dir === 'violated' ? 'bad' : 'warn'
        )} ${chosen || expected ? `<span class="dim small">選了 ${esc(chosen || '—')}，預期 ${esc(expected || '—')}</span>` : ''}</summary>
<div class="detail-body">
${rats.length ? `<h4>它怎麼說服自己的（評分者擷取；標「非逐字」的在產出裡找不到原句）</h4>${rats.map((t, i) => `<blockquote>${esc(t)}${verb[i] === false ? ' <span class="chip warn">非逐字，產出裡找不到</span>' : ''}</blockquote>`).join('')}` : '<p class="muted">沒有留下擷取。</p>'}
${worked.length ? `<h4>哪些壓力起了作用</h4><p>${worked.map((t) => chip(t, 'warn')).join('')}</p>` : ''}
</div></details>`;
      })
      .join('\n');

  const violated = capture.filter((c) => txt(asObj(c).direction) === 'violated');
  const refused = capture.filter((c) => txt(asObj(c).direction) === 'refused');
  const over = capture.filter((c) => txt(asObj(c).direction) === 'overapplied');
  if (violated.length) {
    inner += `<h3>合理化擷取（被壓力推著違規時）</h3><p class="note">共 ${esc(violated.length)} 筆。這些句子是壓力測試最值得看的東西——它示範了規則是怎麼被說服掉的。</p>${renderCapture(violated)}`;
  }
  if (refused.length) {
    inner += `<h3>拒做／沒交付（沒違反規則，但也沒把正當的工作做完）</h3><p class="note">共 ${esc(refused.length)} 筆。先看基準組是不是也這樣——是的話這是模型的行為、不是 skill 的。</p>${renderCapture(refused)}`;
  }
  if (over.length) {
    inner += `<h3>過度套用（不該套用的情境也照套）</h3><p class="note">共 ${esc(over.length)} 筆。守太過跟守不住一樣是問題，分開列。</p>${renderCapture(over)}`;
  }

  return section('pressure', '壓力測試', inner, '看的是規則被推的時候守不守得住，以及它怎麼替自己找理由。');
}

// 8. 觸發測試
function secTrigger(r) {
  const t = asObj(r.trigger);
  if (!r.trigger) return null;
  const sh = asObj(t.should), sn = asObj(t.shouldNot);
  let inner = `<p>該觸發時：<strong>${esc(fmtOr(sh.fired))}/${esc(fmtOr(sh.n))}</strong> 次觸發${
    num(t.recall) !== null ? `（比例 ${esc(num(t.recall).toFixed(2))}）` : ''
  }；不該觸發時：<strong>${esc(fmtOr(sn.fired))}/${esc(fmtOr(sn.n))}</strong> 次誤觸發${
    num(t.falseTriggerRate) !== null ? `（比例 ${esc(num(t.falseTriggerRate).toFixed(2))}）` : ''
  }。</p>`;

  const rows = asArr(t.rows).map((row) => {
    const o = asObj(row);
    return [
      esc(txt(o.kind) === 'should' ? '該觸發' : txt(o.kind) === 'shouldNot' ? '不該觸發' : txt(o.kind)),
      `<div class="wide"><pre>${esc(txt(o.query))}</pre></div>`,
      `<code>${esc(txt(o.run))}</code>`,
      o.fired ? '✓ 有' : '✗ 沒有',
      o.ok === false ? '<span class="chip bad">執行失敗</span>' : '正常',
      { td: `<td class="num">${esc(secFromMs(o.durationMs) === null ? '—' : secFromMs(o.durationMs).toFixed(1))}</td>` },
    ];
  });
  if (rows.length) {
    inner += `<details><summary>逐句明細（${esc(rows.length)} 次）</summary><div class="detail-body">${table(
      ['類', '問句', 'run', '有沒有觸發', '執行', { html: '秒', num: true }],
      rows
    )}</div></details>`;
  }
  return section('trigger', '觸發測試', inner, '觸發只靠 skill 的描述那一段文字；要改觸發率就去改描述，不是改內容。');
}

// 9. 有沒有在做事（足跡）
function secFootprint(r) {
  const fp = asObj(r.footprint);
  const sim = asArr(r.similarity);
  if (!Object.keys(fp).length && !sim.length) return null;
  let inner = '';
  if (Object.keys(fp).length) {
    inner += `<p>帶 skill 那組（<code>${esc(txt(fp.armWith) || 'with')}</code>，負向對照題除外）：${esc(fmtOr(fp.known))} 次可判定裡，${esc(fmtOr(fp.fired))} 次偵測到 skill 被呼叫或讀取。${
      num(fp.negativeKnown) ? `負向對照題 ${esc(fp.negativeKnown)} 次裡，${esc(fmtOr(fp.negativeFired))} 次誤觸發。` : ''
    }</p>`;
    const rows = asArr(fp.cases).map((c) => {
      const o = asObj(c);
      return [
        `<code>${esc(txt(o.case))}</code>`,
        { td: `<td class="num">${esc(fmtRatio(o.crossArmSimilarity))}</td>` },
        { td: `<td class="num">${esc(fmtRatio(o.withinArmSimilarity))}</td>` },
      ];
    });
    if (rows.length) {
      inner += table(['題', { html: '兩組之間的相似度', num: true }, { html: '同組內的相似度', num: true }], rows);
      inner += `<p class="note">兩組之間的數字越接近同組內，代表 skill 越沒改變產出——通過數有差，但產出其實長得差不多。</p>`;
    }
  }
  if (sim.length) {
    const rows = sim.map((s) => {
      const o = asObj(s);
      return [
        `<code>${esc(txt(o.case))}</code>`,
        armHeadHtml(o.arm),
        { td: `<td class="num">${esc(fmtOr(o.pairs))}</td>` },
        { td: `<td class="num">${esc(fmtRatio(o.mean))}</td>` },
        { td: `<td class="num">${esc(fmtRatio(o.max))}</td>` },
      ];
    });
    inner += `<h3>同格 run 的相似度</h3>${table(
      ['題', '組', { html: '配對數', num: true }, { html: '平均', num: true }, { html: '最高', num: true }],
      rows
    )}<p class="note">同格 run 高度相似＝多跑幾次買不到新資訊；下一版把次數換成題數比較划算。</p>`;
  }
  return section('footprint', '有沒有在做事（足跡）', inner, '先確認 skill 真的進場了，通過數才有意義。');
}

// 10. 成本
// token 欄：完整（recorded===total 且 total>0）才顯示中位／總和；不完整就老實標「記錄不完整（recorded/total）」，不冒充總和
function tokenCell(median, sumVal, recorded, total) {
  const med = fmtOr(median);
  if (num(total) !== null && num(total) > 0 && recorded === total) return `${med} ／ ${fmtOr(sumVal)}`;
  return `${med} ／ 記錄不完整（${fmtOr(recorded)}/${fmtOr(total)}）`;
}
function secCost(r, arms) {
  const cost = asObj(r.cost);
  const present = arms.filter((a) => isObj(cost[a]));
  const medianFmt = usdFmt(present.map((a) => num(asObj(cost[a]).medianCostUsd)));
  const sumFmt = usdFmt(present.map((a) => num(asObj(cost[a]).sumCostUsd)));
  const rows = present.map((a) => {
    const c = asObj(cost[a]);
    return [
      armHeadHtml(a),
      { td: `<td class="num">${esc(fmtOr(c.runs))}</td>` },
      { td: `<td class="num">${esc(num(c.medianDurationS) === null ? '—' : num(c.medianDurationS).toFixed(1))}</td>` },
      { td: `<td class="num">${esc(fmtOr(c.medianOutputTokens))}</td>` },
      { td: `<td class="num">${esc(medianFmt(c.medianCostUsd) ?? '—')}</td>` },
      asArr(c.models).map((m) => `<code>${esc(txt(m))}</code>`).join('、') || '—',
    ];
  });
  if (!rows.length) return null;
  let inner = table(
    ['組', { html: '次數', num: true }, { html: '時長中位數（秒）', num: true }, { html: '輸出 token 中位數', num: true }, { html: '每次費用中位數（USD）', num: true }, '實際跑的模型'],
    rows
  );

  // 深究：成本派生欄的完整分子分母與完整度——決策摘要的【成本】行就是從這裡算出來的。
  // 舊報告（1.1.x，沒有場景全對制那組欄位）重出時整段不渲染：不能把 v1.2 的派生語義套到當初沒有這個口徑的資料上（正式裁定 v1.4-5）。
  // 判斷點與 secKeyPoints 共用 isNewReportShape，不各自猜一次（v1.5-4）。
  if (!isNewReportShape(r)) {
    return section('cost', '成本', inner, '中位數（每次大約多少）。費用依帳號方案而異，只當同一次量測內的相對參考。');
  }
  const successFmt = usdFmt(present.map((a) => num(asObj(cost[a]).perSuccessCostUsd)));
  const passedFmt = usdFmt(present.map((a) => num(asObj(cost[a]).perPassedCheckCostUsd)));
  const derivedRows = present.map((a) => {
    const c = asObj(cost[a]);
    const sumCell = c.costComplete === true ? (sumFmt(c.sumCostUsd) ?? '—') : `成本記錄不完整（${esc(fmtOr(c.costRecorded))}/${esc(fmtOr(c.costTotal))}）`;
    const denom = (num(c.successRuns) || 0) + (num(c.notFirstPassRuns) || 0);
    const fpp = denom > 0 ? `${Math.round(((num(c.successRuns) || 0) / denom) * 100)}%（proxy：${esc(fmtOr(c.successRuns))}/${esc(denom)}）` : '—';
    return [
      armHeadHtml(a),
      sumCell,
      { td: `<td class="num">${esc(fmtOr(c.successRuns))}</td>` },
      { td: `<td class="num">${esc(fmtOr(c.notFirstPassRuns))}</td>` },
      { td: `<td class="num">${esc(fmtOr(c.indeterminateRuns))}</td>` },
      { td: `<td class="num">${esc(fmtOr(c.discardedRuns))}</td>` },
      { td: `<td class="num">${esc(successFmt(c.perSuccessCostUsd) ?? '—')}</td>` },
      { td: `<td class="num">${esc(passedFmt(c.perPassedCheckCostUsd) ?? '—')}</td>` },
      `<span class="small dim">${esc(fpp)}</span>`,
      { td: `<td class="num">${esc(tokenCell(c.medianInputTokens, c.sumInputTokens, c.inputTokensRecorded, c.inputTokensTotal))}</td>` },
      { td: `<td class="num">${esc(tokenCell(c.medianOutputTokens, c.sumOutputTokens, c.outputTokensRecorded, c.outputTokensTotal))}</td>` },
    ];
  });
  inner += `<h3>深究：成本派生欄（決策摘要【成本】行的完整分子分母）</h3>
${table(
    ['組', '總成本（USD）', { html: '場景全對（AI 評分）', num: true }, { html: '有效但未成功', num: true }, { html: '無法判定', num: true }, { html: '前置作廢', num: true }, { html: '每次全對的成本', num: true }, { html: '每過格成本', num: true }, '一次到位（proxy）', { html: 'input token（中位／總和）', num: true }, { html: 'output token（中位／總和）', num: true }],
    derivedRows
  )}
<p class="note">「場景全對（AI 評分）」＝該題全部預期檢查（前置／事實／判斷／取向）逐條明確 pass=true——是 AI 評分，不是機械 validator；「有效但未成功」＝其中有一條明確沒過（含前置檢查沒過的 run，它是結果、不是作廢）；「無法判定」＝有判定回 null 或缺判定。前置作廢（執行或評分失敗）的花費仍計進總成本，但不進任何分母。全對率與一次到位率的分母只有「場景全對」＋「有效但未成功」兩類，前置作廢與無法判定都不算進去。任一應計 run 缺值時，總成本與依賴它的每項派生成本一律回不完整，不冒充較小的完整數字。${nz(asObj(r.costFlow).note) ? esc(txt(asObj(r.costFlow).note)) + '。' : ''}</p>`;

  return section(
    'cost',
    '成本',
    inner,
    '第一張表是中位數（每次大約多少）；第二張表是總和與派生欄（總共花多少、每次全對要多少）——兩張表不要互相加減。費用依帳號方案而異，只當同一次量測內的相對參考。'
  );
}

// 11. 旗標＋前置檢查沒過／前置作廢
function secFlags(r) {
  const flags = asArr(r.flags).map(txt);
  const inv = asArr(r.invalidRuns).map(txt);
  const hf = asArr(r.harnessFailures).map(txt);
  if (!flags.length && !inv.length && !hf.length) return null;
  let inner = '';
  if (flags.length) {
    inner += `<ul>${flags
      .map((f) => {
        const i = f.indexOf('：');
        const cat = i > 0 ? f.slice(0, i) : '';
        const body = i > 0 ? f.slice(i + 1) : f;
        const kind = /反而較差|恆不過|沒被載入|誤觸發|看不出足跡/.test(cat) ? 'bad' : /偏向|同格|壓力/.test(cat) ? 'warn' : '';
        return `<li>${cat ? chip(cat, kind) + ' ' : ''}${esc(body)}</li>`;
      })
      .join('')}</ul>`;
  } else {
    inner += '<p class="muted">沒有旗標。</p>';
  }
  if (inv.length) {
    inner += `<h3>沒過前置檢查的 run（有效但未成功，不進計分；是結果、不是作廢）</h3><p>${inv.map((x) => `<code>${esc(x)}</code>`).join('、')}</p>`;
  }
  if (hf.length) {
    inner += `<h3>執行或評分失敗（不算受測物的結果，要補跑）</h3><p>${hf.map((x) => `<code>${esc(x)}</code>`).join('、')}</p>`;
  }
  return section('flags', '旗標（天花板與有效樣本檢查）', inner, '有旗標的地方，結論要跟著旗標一起講。');
}

// 12. 下一步
function secNextSteps(r) {
  const steps = asArr(r.nextSteps).map(txt).filter(Boolean);
  if (!steps.length) return null;
  return section('next', '下一步', `<ul>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`, '由上面的旗標推導；接回建 skill 的迴圈。');
}

// 13. 逐份看產出
function secOutputs(r, arms) {
  const runs = asArr(r.runs).filter(isObj);
  if (!runs.length) {
    return section(
      'outputs',
      '逐份看產出',
      `<p class="muted">這份報告沒有帶逐 run 明細（<code>runs[]</code>）——可能是舊版引擎產生的。原始產出還在量測目錄底下的 <code>runs/&lt;題&gt;/&lt;組&gt;/r*/</code>，可以直接開。</p>`,
      '數字看完之後，真正該做的事：把產出一份一份讀過。'
    );
  }

  const assertions = asObj(r.assertions);
  const caseOrder = asArr(r.cases).map((c) => txt(asObj(c).id));
  const byCase = new Map();
  for (const run of runs) {
    const k = txt(run.case) || '（未標題號）';
    if (!byCase.has(k)) byCase.set(k, []);
    byCase.get(k).push(run);
  }
  const keys = [...byCase.keys()].sort((a, b) => {
    const ia = caseOrder.indexOf(a), ib = caseOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  const caseMeta = new Map(asArr(r.cases).map((c) => [txt(asObj(c).id), asObj(c)]));
  // 逐 run 的費用 chip 跟這一頁所有 run 共用同一個 usdFmt（位數一起挑、碰撞一起附原值）——不能每個 chip 各配各的 toFixed（v1.5-3）。
  const runCostFmt = usdFmt(runs.map((x) => num(asObj(x).costUsd)));

  const blocks = keys
    .map((k) => {
      const list = byCase.get(k);
      const meta = asObj(caseMeta.get(k));
      const armKeys = [...new Set([...arms, ...list.map((x) => txt(x.arm))])].filter((a) => list.some((x) => txt(x.arm) === a));
      const cols = armKeys
        .map((a) => {
          const mine = list.filter((x) => txt(x.arm) === a).sort((x, y) => natCmp(x.run, y.run));
          return `<div><div class="col-head">${armHeadHtml(a)}</div>${mine.map((run) => runDetails(run, assertions, runCostFmt)).join('')}</div>`;
        })
        .join('');
      return `<div class="case-block">
<h3><code>${esc(k)}</code>${nz(meta.type) ? ` <span class="chip">${esc(caseTypeLabel(txt(meta.type)))}</span>` : ''}</h3>
<div class="grid">${cols}</div>
</div>`;
    })
    .join('\n');

  const inner = `<div class="toolbar">
<button type="button" data-toggle-all="open" data-scope="outputs-body">全部展開</button>
<button type="button" data-toggle-all="close" data-scope="outputs-body">全部收合</button>
<label class="toggle"><input type="checkbox" data-filter-fail data-scope="outputs-body"> 只看有不通過的 run</label>
</div>
<div id="outputs-body">${blocks}</div>`;

  return section(
    'outputs',
    '逐份看產出',
    inner,
    `共 ${esc(runs.length)} 份。展開就看得到那一次的判定、證據逐字引句、產出全文與寫出的檔案——數字看完之後，真正該做的事就是把產出一份一份讀過。`
  );
}

function runDetails(run, assertions, costFmt) {
  const o = asObj(run);
  const verdicts = asArr(o.verdicts).map(asObj);
  const scored = verdicts.filter((v) => !FAMILY_UNSCORED.has(txt(asObj(asObj(assertions)[txt(v.id)]).family)) && v.pass !== null); // pass:null＝判不出來、不算分
  const passN = scored.filter((v) => v.pass).length;
  const hasFail = scored.some((v) => !v.pass) || o.gateFailed || o.harnessFailure || o.timedOut || o.ok === false;

  const chips = [];
  if (o.harnessFailure) chips.push(chip('執行或評分失敗', 'bad'));
  else if (o.gateFailed) chips.push(chip('前置檢查沒過（有效但未成功，不進計分）', 'warn'));
  else if (o.ok === false) chips.push(chip('沒跑完', 'bad'));
  else chips.push(chip('正常', 'ok'));
  if (o.timedOut) chips.push(chip('逾時', 'bad'));
  if (scored.length) chips.push(chip(`計分通過 ${passN}/${scored.length}`, passN === scored.length ? 'ok' : ''));
  const dur = fmtDur(secFromMs(o.durationMs));
  if (dur) chips.push(chip(dur));
  if (num(o.outputTokens) !== null) chips.push(chip(`輸出 ${o.outputTokens} token`));
  if (num(o.costUsd) !== null) chips.push(chip(costFmt ? costFmt(num(o.costUsd)) : `$${num(o.costUsd).toFixed(4)}`));
  if (o.skillFired === true) chips.push(chip('skill 載入 ✓', 'ok'));
  else if (o.skillFired === false) chips.push(chip('skill 載入 ✗', 'warn'));
  else chips.push(chip('skill 載入 判不出來'));

  const vRows = verdicts.map((v) => {
    const meta = asObj(asObj(assertions)[txt(v.id)]);
    const unscored = FAMILY_UNSCORED.has(txt(meta.family));
    return [
      `<div class="wide"><code>${esc(txt(v.id))}</code>${assertionDispHtml(meta)}<span class="id">${esc(familyLabel(meta.family))}${unscored ? '／不計分' : ''}</span></div>`,
      v.pass === null ? '<span class="muted">不算分（判不出來）</span>' : v.pass ? '<strong>通過</strong>' : '<strong>不通過</strong>',
      nz(v.evidence) ? `<blockquote>${esc(txt(v.evidence))}</blockquote>` : '<span class="muted">評分沒有留下引句</span>',
    ];
  });

  const artifacts = asArr(o.artifacts).map(asObj);
  const artHtml = artifacts.length
    ? artifacts
        .map(
          (a) =>
            `<details><summary><code>${esc(txt(a.name))}</code>${a.truncated ? ' ' + chip('內容已截斷', 'warn') : ''}</summary><div class="detail-body">${
              a.text === null || a.text === undefined ? '<p class="muted">沒有保留內容（可能太大或是二進位檔）。</p>' : `<pre>${esc(txt(a.text))}</pre>`
            }</div></details>`
        )
        .join('')
    : '<p class="muted">這一次沒有寫出檔案（產出只在對話回覆裡）。</p>';

  const p = asObj(o.pressure);
  const pressureHtml = Object.keys(p).length
    ? `<h4>壓力測試</h4>
<p>${chip(PRESSURE_VERDICT[txt(p.verdict)] || txt(p.verdict) || '—', txt(p.verdict) === 'held' ? 'ok' : 'bad')}${
        nz(p.chosenOption) || nz(p.expectedOption) ? ` <span class="small dim">選了 ${esc(txt(p.chosenOption) || '—')}，預期 ${esc(txt(p.expectedOption) || '—')}</span>` : ''
      }${p.citedSkill === true ? ' ' + chip('有引用 skill') : p.citedSkill === false ? ' ' + chip('沒有引用 skill', 'warn') : ''}</p>
${asArr(p.rationalizations).length ? `<p class="small dim">它怎麼說服自己的（逐字）：</p>${asArr(p.rationalizations).map((t) => `<blockquote>${esc(txt(t))}</blockquote>`).join('')}` : ''}
${asArr(p.pressuresThatWorked).length ? `<p class="small dim">起作用的壓力：${asArr(p.pressuresThatWorked).map((t) => chip(txt(t), 'warn')).join('')}</p>` : ''}`
    : '';

  const model = nz(txt(o.mainModel)) ? `<p class="small dim">實際跑的模型：<code>${esc(txt(o.mainModel))}</code>${
    nz(o.effort) ? `（effort ${esc(txt(o.effort))}）` : ''
  }${num(o.inputTokens) !== null ? `；輸入 ${esc(o.inputTokens)} token` : ''}</p>` : '';

  return `<details class="run" data-hasfail="${hasFail ? '1' : '0'}">
<summary><span class="rk">${esc(txt(o.run) || 'run')}</span> ${chips.join('')}</summary>
<div class="detail-body">
${model}
<h4>判定</h4>
${vRows.length ? table(['檢查項', '判定', '證據（評分者的逐字引句）'], vRows) : `<p class="muted">${o.harnessFailure || o.ok === false ? '這一次沒有判定（執行或評分失敗，需要補跑）。' : '這一次沒有留下判定（可能還沒評分）。'}</p>`}
<h4>產出全文${o.outputTruncated ? ' ' + chip('已截斷', 'warn') : ''}</h4>
${nz(o.output) ? `<pre>${esc(txt(o.output))}</pre>` : '<p class="muted">沒有保留產出全文。</p>'}
<h4>寫出的檔案</h4>
${artHtml}
${pressureHtml}
</div>
</details>`;
}

// ============================================================
// renderMatrixHtml — 多個「模型 × effort」組合
// ============================================================
// ---------- 給人看的一頁（v1.3）：renderPersonPageHtml ----------
// 純格式化：所有會顯示在頁面上的數字（百分比、差額、同率題數、子集題數、觸發缺口）都由 gauge.mjs 的
// personPage 預算好；這裡不產生新的顯示數字（美元位數對齊等格式化不在此限）（v1.3-R1 MF-7＋R2）。
// 缺必要欄位或與裁決不一致＝誠實缺頁句（S-11），不硬湊。
export function renderPersonPageHtml(report, opts = {}) {
  const r = asObj(report);
  const name = nz(txt(r.name)) || '（未命名）';
  const title = txt(opts.title || `${name} — 給人看的一頁`);
  const foot = `<p>這一頁由量測引擎直接從 report.json 產生——不是 AI 現場寫的。工程完整版（每一份產出、評分證據、逐條檢查）在同資料夾的 report.html；拿不到那份檔案的話，向給你這一頁的人要。</p><p>頁面上的每個數字都只描述這一次的條件；換模型、換題目，數字就不是這樣。</p>`;
  const pp = r.personPage;
  // 深度 guard（S-11＋MF-1 旁路封死）：三欄位不只要是物件，內容也要立得住；裁決是 stop／no-data 時
  // personPage 必須自己標 available=false——舊引擎或手改出的「stop＋available:true」一律當缺頁，不印比較。
  const blockedKind = ['stop', 'no-data'].includes(asObj(r.decisionFirstData).verdict?.kind);
  const srObj = asObj(asObj(pp).successRate);
  const srOk = srObj.available === false || (isObj(srObj.full) && isObj(srObj.full.with) && num(srObj.full.with.d) !== null);
  const usable = isObj(pp) && isObj(pp.conclusion) && isObj(pp.successRate) && isObj(pp.boundary)
    && srOk && (nz(asObj(pp.conclusion).line) || nz(asObj(pp.conclusion).label))
    && !(blockedKind && srObj.available !== false);
  if (!usable) {
    return page({ title, h1: title, chipsHtml: '', sections: [section('missing', '這一頁出不來', `<p>這份 report.json 沒有「給人看的一頁」需要的完整結構化資料（1.3.0 以前的引擎產的，或欄位缺損）。工程版照常可看（report.html）；要出這一頁，用現行引擎重新量測或重算報告。</p>`, null)], footerHtml: foot });
  }
  const cellTxt = (c) => (isObj(c) && num(c.d) ? `${txt(c.n)}/${txt(c.d)}${num(c.pct) !== null ? `（${txt(c.pct)}%）` : ''}` : '—');
  const concl = asObj(pp.conclusion);
  const sr = asObj(pp.successRate);
  const lines = [];
  if (nz(concl.label)) lines.push(`<p class="big"><strong>${esc(txt(concl.label))}</strong></p>`);
  if (nz(concl.line)) lines.push(`<p>${esc(txt(concl.line))}</p>`);
  if (sr.available === false) {
    lines.push(`<p><strong>${esc(txt(sr.reason))}</strong></p>`);
  } else {
    const full = asObj(sr.full), inf = isObj(sr.informative) ? sr.informative : null;
    const sameN = num(sr.sameRateCases);
    lines.push(`<p><strong>正式讀數（全部情境）：帶 ${esc(cellTxt(full.with))} vs 不帶 ${esc(cellTxt(full.without))}</strong>${sameN ? `（其中 ${esc(txt(sameN))} 個情境兩組同率——貢獻分母、不貢獻差異訊號）` : ''}</p>`);
    if (inf) lines.push(`<p>診斷視角（事後子集）：只看本次結果兩組率不同的 ${esc(txt(num(inf.count) !== null ? inf.count : '？'))} 個情境——帶 ${esc(cellTxt(inf.with))} vs 不帶 ${esc(cellTxt(inf.without))}。<em>這個子集是看完結果才挑的，會放大表面差距；只用來指路（哪些情境值得先看），不可當推論或比較的證據——正式判定用上面的全分母。</em></p>`);
    for (const os of asArr(sr.oneSided)) if (isObj(os)) lines.push(`<p>「${esc(txt(os.label))}」只有 ${esc(txt(os.side))} 這一側的資料——資料不完整，不入比較。</p>`);
    for (const c of asArr(sr.corrections)) {
      if (!isObj(c) || !isObj(c.range)) continue;
      lines.push(`<p>反事實界線：如果沒過前置檢查的那些次（帶 ${esc(txt(c.counts?.with ?? 0))} 次、不帶 ${esc(txt(c.counts?.without ?? 0))} 次）其實會成功——差距＝原始 ${esc(txt(c.gap))} 次＋x−y（x≤${esc(txt(c.counts?.with ?? 0))}、y≤${esc(txt(c.counts?.without ?? 0))}），落在 <strong>${esc(txt(c.range.min))}〜${esc(txt(c.range.max))} 次</strong>。<em>這是單一反事實的界線，不是偏誤校正、也不是信賴區間；它沒處理的還有：樣本小、單輪模擬、兩組非同時段執行。</em></p>`);
    }
    const nums = asObj(pp.numbers);
    if (isObj(nums.with) || isObj(nums.without)) {
      const dg = usdDigits([nums.with?.perSuccessCostUsd?.value, nums.without?.perSuccessCostUsd?.value]);
      const one = (k, label) => { const m = nums[k]?.perSuccessCostUsd; return isObj(m) ? `${label} ${fmtUsd(m.value, dg)}（＝總花費 ${fmtUsd(m.numerator, dg)} ÷ 全對 ${esc(txt(m.denominator))} 次）` : null; };
      const parts = [one('with', '帶'), one('without', '不帶')].filter(Boolean);
      if (parts.length) lines.push(`<p>每次全對的花費：${parts.join('；')}。</p>`);
    }
  }
  if (nz(concl.scope)) lines.push(`<p><em>${esc(txt(concl.scope))}</em></p>`);
  const secConclusion = section('pp-conclusion', '結論', lines.join('\n'), '頭條、它的但書與界線在同一張卡上——只轉傳這一段也不會丟掉限制。');
  const mapRows = asArr(pp.map).filter(isObj);
  const secMap = mapRows.length ? section('pp-map', '情境地圖', `<table><thead><tr><th>情境</th><th>帶</th><th>不帶</th><th></th></tr></thead><tbody>${mapRows.map((x) => `<tr><td>${esc(txt(x.label))}</td><td>${esc(cellTxt(x.with))}</td><td>${esc(cellTxt(x.without))}</td><td>${x.thin ? '每格 ≤3 次——翻 1 次就變樣，當線索不當定論' : ''}</td></tr>`).join('')}</tbody></table>`, '全對＝那一題的每條預期檢查都做對才算一次。') : null;
  const fnd = asArr(pp.findings).filter(isObj);
  const secFindings = fnd.length ? section('pp-findings', '發現', `<ul class="keypoints">${fnd.map((f) => {
    if (f.attribution === 'undetermined') return `<li>${esc(txt(f.text))}<br><strong>歸因未定案</strong>——兩種可能：${asArr(f.alternatives).map((a) => esc(txt(a))).join('；')}。<br>怎麼分開：${esc(txt(f.separationHint))}</li>`;
    return `<li>${esc(txt(f.text))}</li>`;
  }).join('')}</ul>`, null) : null;
  const bLines = [];
  if (nz(asObj(pp.boundary).line)) bLines.push(`<p>${esc(txt(pp.boundary.line))}</p>`);
  const tg = isObj(pp.trigger) ? pp.trigger : null;
  if (tg && num(tg.should?.n) !== null) bLines.push(`<p>觸發：該觸發的 ${esc(txt(tg.should.n))} 次裡觸發了 ${esc(txt(tg.should.fired))} 次${num(tg.should.missed) ? `、${esc(txt(tg.should.missed))} 次沒觸發` : ''}。</p>`);
  if (tg && num(tg.shouldNot?.n) !== null) bLines.push(`<p>誤觸發：不該觸發的 ${esc(txt(tg.shouldNot.n))} 次裡${tg.shouldNot.fired === 0 ? `沒有誤觸發——是「這 ${esc(txt(tg.shouldNot.n))} 次裡沒有」，樣本就這麼多，不是保證` : `誤觸發了 ${esc(txt(tg.shouldNot.fired))} 次`}。</p>`);
  const secBoundary = bLines.length ? section('pp-boundary', '邊界', bLines.join('\n'), null) : null;
  const nx = asArr(pp.next).filter(isObj);
  const secNext = nx.length ? section('pp-next', '下一步', `<ul class="keypoints">${nx.map((x) => `<li><strong>［${esc(txt(x.tag || '建議'))}｜誰能動手：${esc(txt(x.actor || '——'))}］</strong> ${esc(txt(x.text))}</li>`).join('')}</ul>`, '每一條都標了誰能動手——拿到這頁的人不必自己猜要找誰。') : null;
  const chips = [];
  if (nz(r.generatedAt)) chips.push(chip(`產生時間 ${txt(r.generatedAt)}`));
  if (nz(asObj(r.conditions).executorModel)) chips.push(chip(`執行模型 ${txt(r.conditions.executorModel)}`));
  if (nz(r.engine)) chips.push(chip(`量測引擎 ${txt(r.engine)}`));
  return page({ title, h1: title, chipsHtml: chips.join(''), sections: [secConclusion, secMap, secFindings, secBoundary, secNext], footerHtml: foot });
}

export function renderMatrixHtml(matrix, opts = {}) {
  const m = asObj(matrix);
  const combos = asArr(m.combos).map(asObj);
  const arms = (() => {
    const set = new Set(asArr(m.arms).map(txt).filter(Boolean));
    for (const c of combos) {
      for (const k of Object.keys(asObj(c.totals))) set.add(k);
      for (const k of Object.keys(asObj(c.cost))) set.add(k);
    }
    return [...set];
  })();
  const name = nz(txt(m.name)) || '（未命名）';
  const title = txt(opts.title || `skill-gauge 矩陣 — ${name}`);

  const chips = [];
  if (nz(m.generatedAt)) chips.push(chip(`產生時間 ${txt(m.generatedAt)}`));
  chips.push(chip(`${combos.length} 個組合`));
  if (nz(m.judgeModel)) chips.push(chip(`評分模型 ${txt(m.judgeModel)}`));
  if (num(m.runsPlanned) !== null) chips.push(chip(`每題每組計畫跑 ${m.runsPlanned} 次`));

  // 每格連到自己的 report.html。引擎寫進 matrix.json 的 outDir 是相對的格名（矩陣 HTML 與各格資料夾同層），
  // 直接接上去就對；只有拿到絕對路徑時才需要換算成相對這一頁的位置。
  const hrefFor = (c) => {
    const dir = txt(c.outDir);
    if (!dir) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dir) || /[<>"'\s]/.test(dir) || dir.split(/[\\/]/).includes('..')) return null; // 不接受帶 scheme（javascript: 等）、引號、空白、.. 的路徑
    let rel;
    try {
      if (!path.isAbsolute(dir)) rel = path.join(dir, 'report.html');
      else if (opts.baseDir) rel = path.relative(opts.baseDir, path.join(dir, 'report.html'));
      else rel = path.join(path.basename(dir), 'report.html');
    } catch {
      rel = path.join(path.basename(dir), 'report.html');
    }
    return encodeURI(rel.split(path.sep).join('/'));
  };

  const statusChip = (s) =>
    s === 'done' ? chip('跑完', 'ok') : s === 'stopped' ? chip('停案', 'warn') : s === 'failed' ? chip('失敗', 'bad') : chip(txt(s) || '—');

  // 矩陣整頁的每次費用中位數共用一個 usdFmt（位數一起挑、碰撞一起附原值）——不能每一格各自 toFixed(3)（v1.5-3）。
  const matrixCostFmt = usdFmt(combos.flatMap((c) => arms.map((a) => num(asObj(asObj(c.cost)[a]).medianCostUsd))));

  // 總表
  const rows = combos.map((c) => {
    const sens = sensitivityOf(c, arms);
    const href = hrefFor(c);
    const tg = asObj(c.trigger);
    const ps = asObj(c.pressureSummary);
    const costTxt = arms
      .map((a) => {
        const x = asObj(asObj(c.cost)[a]);
        if (num(x.medianDurationS) === null && num(x.medianCostUsd) === null) return null;
        return `${esc(armSay(a))}${esc(num(x.medianDurationS) === null ? '—' : num(x.medianDurationS).toFixed(0))} 秒／${esc(
          matrixCostFmt(x.medianCostUsd) ?? '$—'
        )}`;
      })
      .filter(Boolean)
      .join('<br>');
    return [
      `<div><strong class="nw">${esc(nz(txt(c.executorModel)) || '?')}</strong>${nz(c.slug) ? `<span class="id">${esc(txt(c.slug))}</span>` : ''}${
        href ? `<div class="small"><a href="${esc(href)}">看這一格的報告</a></div>` : ''
      }</div>`,
      nz(c.effort) ? `<code>${esc(txt(c.effort))}</code>` : '—',
      statusChip(txt(c.status)) + (nz(c.error) ? `<div class="small dim">${esc(txt(c.error))}</div>` : ''),
      ...arms.map((a) => ({ td: heatCell(asObj(c.totals)[a]) })),
      { td: `<td class="num">${sens ? esc(sens.delta) : '—'}</td>` },
      { td: `<td class="num">${sens ? esc(dash(sens.flipsToReverse)) : '—'}</td>` },
      nz(c.baselineVerdict) ? esc(BASELINE_VERDICT[txt(c.baselineVerdict)] || txt(c.baselineVerdict)) : '—',
      num(tg.recall) !== null || num(tg.falseTriggerRate) !== null
        ? `該觸發 ${esc(num(tg.recall) === null ? '—' : num(tg.recall).toFixed(2))}<br><span class="small dim">誤觸發 ${esc(
            num(tg.falseTriggerRate) === null ? '—' : num(tg.falseTriggerRate).toFixed(2)
          )}</span>`
        : '—',
      Object.keys(ps).length
        ? Object.entries(ps)
            .map(([a, v]) => `${esc(armSay(a))}${esc(fmtOr(asObj(v).held))}/${esc(fmtOr(asObj(v).total))}`)
            .join('<br>')
        : '—',
      costTxt || '—',
      asArr(c.flags).length ? `<span class="chip warn">${esc(asArr(c.flags).length)} 條</span>` : '<span class="muted">0</span>',
    ];
  });

  const totalsTable = table(
    [
      '模型',
      'effort',
      '狀態',
      ...arms.map((a) => ({ html: armHeadHtml(a), num: true })),
      { html: '差距', num: true },
      { html: '翻幾格反轉', num: true },
      '停案判定',
      '觸發',
      '壓力（守住／總）',
      '成本中位數',
      '旗標',
    ],
    rows
  );

  // 逐條檢查項 × 組合
  const ids = (() => {
    const set = new Set(asArr(m.assertionIds).map(txt).filter(Boolean));
    for (const c of combos) for (const k of Object.keys(asObj(c.assertions))) set.add(k);
    return [...set];
  })();
  const A = arms[0], B = arms[1];
  let gridTable = '';
  if (ids.length && combos.length) {
    const gRows = ids.map((id) => {
      const cells = combos.map((c) => {
        const x = asObj(asObj(c.assertions)[id]);
        const a = asObj(x[A]), b = asObj(x[B]);
        const fa = passFrac(a), fb = passFrac(b);
        if (!fa && !fb) return { td: '<td class="cell none">—</td>' };
        const d = num(a.pass) !== null && num(b.pass) !== null ? num(a.pass) - num(b.pass) : null;
        const denom = Math.max(num(a.total) || 0, num(b.total) || 0, 1);
        const mag = d === null ? 0 : Math.min(1, Math.abs(d) / denom);
        const cls = d === null ? 'delta' : d > 0 ? 'delta up' : d < 0 ? 'delta down' : 'delta';
        return {
          td: `<td class="${cls}" style="--m:${mag.toFixed(3)}"><span class="frac">${esc(fa || '—')} · ${esc(fb || '—')}</span>${
            d === null ? '' : `<span class="d">${d > 0 ? '+' : ''}${esc(d)}</span>`
          }</td>`,
        };
      });
      return [`<div class="wide"><code>${esc(id)}</code></div>`, ...cells];
    });
    gridTable = `<p class="note">每格是「${esc(armName(A))} · ${esc(armName(B))}」的通過／總格，底下的數字是兩者相差幾格。底色只表示差距大小，正差有底色、負差加外框——不是好壞的紅綠燈。</p>
${table(['檢查項', ...combos.map((c) => ({ html: `${esc(nz(txt(c.executorModel)) || '?')}<span class="id">${esc(txt(c.effort) || '—')}</span>`, num: true }))], gRows)}`;
  }

  // 旗標彙整
  let flagsHtml = '';
  const withFlags = combos.filter((c) => asArr(c.flags).length);
  if (withFlags.length) {
    const catCount = new Map();
    for (const c of withFlags)
      for (const f of asArr(c.flags)) {
        const s = txt(f);
        const i = s.indexOf('：');
        const cat = i > 0 ? s.slice(0, i) : s;
        catCount.set(cat, (catCount.get(cat) || 0) + 1);
      }
    flagsHtml = `<p>${[...catCount.entries()].map(([k, v]) => chip(`${k} ${v}`, 'warn')).join('')}</p>` +
      withFlags
        .map(
          (c) =>
            `<details><summary><strong>${esc(nz(txt(c.executorModel)) || '?')}</strong> ／ ${esc(txt(c.effort) || '—')}（${esc(
              asArr(c.flags).length
            )} 條）</summary><div class="detail-body"><ul>${asArr(c.flags).map((f) => `<li>${esc(txt(f))}</li>`).join('')}</ul></div></details>`
        )
        .join('');
  }

  const notes = asArr(m.notes).map(txt).filter(Boolean);

  const sections = [
    section(
      'howto',
      '這份矩陣是什麼',
      `<p>同一份鎖定的題目，放到 <strong>${esc(combos.length)}</strong> 個「模型 × effort」組合各跑一次。每一格都是一次完整的量測：有自己的停案規則、自己的翻幾格反轉、自己的旗標。</p>
<p class="bar"><strong>不同組合之間不互相當基準。</strong>每一格只跟它自己的對照組比；橫著看只能看「這個 skill 在不同模型上的表現長什麼樣」，不能拿甲模型的通過數去說乙模型比較差。翻幾格反轉也是各格各自算。</p>` +
        (notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '')
    ),
    section('grid', '總表', totalsTable, '差距與翻幾格反轉：優先用那一格報告裡的敏感度；沒有帶就用兩組通過數當場算（公式相同）。'),
    section('assertions', '逐條檢查項 × 組合', gridTable),
    section('flags', '旗標彙整', flagsHtml, '有旗標的格子，結論要跟著旗標一起講。'),
  ];

  const footer = `<p>這一頁由 skill-gauge 的 <code>render.mjs</code> 從 <code>matrix.json</code> 產生，沒有連任何外部資源。每一格的連結指向該組合自己的 <code>report.html</code>（要先渲染過才打得開）。</p>
<p>所有數字都只描述這一次的條件。跨組合的比較是描述，不是因果；可說明與無法說明以 pre-registration 為準。</p>`;

  return page({ title, h1: title, chipsHtml: chips.join(''), sections, footerHtml: footer });
}

// ============================================================
// renderDescribeHtml — 描述優化迴圈
// ============================================================
export function renderDescribeHtml(describe, opts = {}) {
  const d = asObj(describe);
  const rounds = asArr(d.rounds).map(asObj);
  const split = asObj(d.split);
  const train = asArr(split.train).map(asObj);
  const test = asArr(split.test).map(asObj);
  const best = asObj(d.best);
  const name = nz(txt(d.name)) || nz(txt(d.skill)) || '（未命名）';
  const title = txt(opts.title || `skill-gauge 描述優化 — ${name}`);

  const chips = [];
  if (nz(d.skill)) chips.push(chip(`skill ${txt(d.skill)}`));
  if (nz(d.generatedAt)) chips.push(chip(`產生時間 ${txt(d.generatedAt)}`));
  if (nz(d.proposerModel)) chips.push(chip(`出題改寫模型 ${txt(d.proposerModel)}`));
  if (nz(d.triggerModel)) chips.push(chip(`觸發測試模型 ${txt(d.triggerModel)}`));
  if (num(d.runsPerQuery) !== null) chips.push(chip(`每題跑 ${d.runsPerQuery} 次`));
  chips.push(chip(d.applied ? '已套用' : '尚未套用', d.applied ? 'ok' : ''));

  const howto = `<p>skill 會不會在該出手的時候出手，只看它描述那一段文字。這一頁做的事：把問句分成兩堆——<strong>練習題（train）${esc(
    train.length
  )} 題</strong>拿來改寫描述（提案模型只看得到這一堆的失敗）、<strong>驗收題（test）${esc(test.length)} 題</strong>提案模型看不到，但引擎每一輪都量它，最後用它選最佳${
    num(d.holdout) !== null ? `（保留比例 ${esc(fmtRatio(d.holdout))}）` : ''
  }。每題各跑 ${esc(fmtOr(d.runsPerQuery))} 次，觸發次數達一半（含平手）算有觸發。最佳版本用驗收題的分數選（同分才看練習題），不是用練習題選——用練習題選會選到「剛好背起來」的那一版。</p>
<p class="bar">驗收題只有 ${esc(test.length)} 題，翻一格分數就變；而且「選最佳」用的就是驗收題，所以最佳那一輪的驗收分數偏樂觀。這裡選出來的「最佳」是這一次的最佳，不是通則；要當證據，換一組全新的問句再跑一次觸發測試。</p>`;

  const roundRows = rounds.map((r) => {
    const tr = asObj(r.train), te = asObj(r.test);
    return [
      `<code>${esc(fmtOr(r.round))}</code>`,
      esc(txt(r.source) === 'current' ? '目前的描述' : txt(r.source) === 'proposed' ? '改寫版' : txt(r.source)) || '—',
      { td: `<td class="num">${esc(dash(passFrac({ pass: tr.passed, total: tr.total })))}</td>` },
      { td: `<td class="num">${esc(dash(passFrac({ pass: te.passed, total: te.total })))}</td>` },
      nz(r.description)
        ? `<details><summary>看這一輪的描述全文</summary><div class="detail-body"><pre>${esc(txt(r.description))}</pre></div></details>`
        : '<span class="muted">沒有留下描述</span>',
    ];
  });

  const bestHtml = Object.keys(best).length
    ? `<p>第 <strong>${esc(fmtOr(best.round))}</strong> 輪：驗收題 <strong>${esc(nz(txt(best.testScore)) || '—')}</strong>、練習題 ${esc(
        nz(txt(best.trainScore)) || '—'
      )}。</p>
${nz(best.description) ? `<pre>${esc(txt(best.description))}</pre>` : '<p class="muted">沒有留下描述全文。</p>'}
<p class="note">驗收題只有 ${esc(test.length)} 題——翻一格就換一個「最佳」。要當結論用，先把題數加上去。</p>`
    : '';

  const perQueryTable = (label, rows) => {
    if (!rows.length) return '';
    const roundNums = rounds.map((r) => fmtOr(r.round));
    const byQuery = new Map();
    for (const q of rows) byQuery.set(txt(q.query), { shouldTrigger: q.shouldTrigger, cells: new Map() });
    for (const r of rounds) {
      const arr = asArr(asObj(r[label === 'train' ? 'train' : 'test']).perQuery).map(asObj);
      for (const q of arr) {
        const k = txt(q.query);
        if (!byQuery.has(k)) byQuery.set(k, { shouldTrigger: q.shouldTrigger, cells: new Map() });
        byQuery.get(k).cells.set(fmtOr(r.round), q);
      }
    }
    const trs = [...byQuery.entries()].map(([q, v]) => [
      `<div class="wide"><pre>${esc(q)}</pre></div>`,
      v.shouldTrigger === false ? '不該觸發' : v.shouldTrigger === true ? '該觸發' : '—',
      ...roundNums.map((rn) => {
        const q2 = asObj(v.cells.get(rn));
        if (!Object.keys(q2).length) return { td: '<td class="cell none">—</td>' };
        const fired = num(q2.fired), n = num(q2.n);
        const okRate = q2.pass === true ? 1 : q2.pass === false ? 0 : n ? (v.shouldTrigger === false ? 1 - fired / n : fired / n) : 0;
        return {
          td: `<td class="cell" style="--r:${okRate.toFixed(3)}"><span class="frac">${esc(dash(fmtNum(fired)))}/${esc(dash(fmtNum(n)))}</span><span class="sub">${
            q2.pass === true ? '符合預期' : q2.pass === false ? '不符預期' : ''
          }</span></td>`,
        };
      }),
    ]);
    return `<h3>${label === 'train' ? '練習題（train）' : '驗收題（test，全程沒看過）'}</h3>${table(
      ['問句', '預期', ...roundNums.map((rn) => ({ html: `第 ${esc(rn)} 輪<span class="id">觸發／次數</span>`, num: true }))],
      trs
    )}`;
  };

  const sections = [
    section('howto', '這一頁在做什麼', howto),
    section('rounds', '逐輪', table(['輪', '來源', { html: '練習題', num: true }, { html: '驗收題', num: true }, '描述'], roundRows), '練習題拿來改，驗收題拿來選——所以看驗收題那一欄，並記得它偏樂觀。'),
    section('best', '選出來的描述', bestHtml),
    section('queries', '逐題明細', perQueryTable('train', train) + perQueryTable('test', test), '底色深＝符合預期（該觸發的有觸發、不該觸發的沒觸發）。'),
    section('apply', '怎麼套用', nz(d.note) ? `<p>${esc(txt(d.note))}</p>` : '', '套用之後要重跑一次觸發測試，別直接相信這一頁的分數。'),
  ];

  const footer = `<p>這一頁由 skill-gauge 的 <code>render.mjs</code> 從 <code>describe.json</code> 產生，沒有連任何外部資源。</p>
<p>描述優化只動觸發，不動 skill 的內容——內容好不好要用量測報告看，兩件事不要混為一談。</p>`;

  return page({ title, h1: title, chipsHtml: chips.join(''), sections, footerHtml: footer });
}

// ============================================================
// mdToHtml — 最小、安全、不會炸的 markdown → HTML（給核可頁與預先登錄全文用）
// ============================================================
// 行內語法：先跳脫再處理，`**粗體**`／`` `code` ``
function inlineMd(s) {
  let x = esc(s);
  x = x.replace(/`([^`]+)`/g, '<code>$1</code>');
  x = x.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return x;
}
export function mdToHtml(md, opts = {}) {
  const headingOffset = Math.max(0, Math.min(4, Number(opts.headingOffset) || 0)); // 嵌在區塊裡時把 # 降級（h1→h3），免得比區塊標題還大
  try {
    const src = txt(md);
    if (!src) return '';
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = []; } };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // 圍籬程式碼區塊
      if (/^```/.test(line)) {
        flushPara();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳過結束的 ```（沒有結束也安全：i 會超出陣列長度，迴圈自然結束）
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      // ATX 標題
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { flushPara(); const lvl = Math.min(6, h[1].length + headingOffset); out.push(`<h${lvl}>${inlineMd(h[2].trim())}</h${lvl}>`); i++; continue; }
      // pipe 表格：標頭列 + 分隔列（---）
      if (/\|/.test(line) && line.trim() && lines[i + 1] && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flushPara();
        const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        out.push(`<table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      // 無序清單
      if (/^\s*[-*]\s+/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        out.push(`<ul>${items.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ul>`);
        continue;
      }
      // 有序清單
      if (/^\s*\d+[.)]\s+/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
        out.push(`<ol>${items.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ol>`);
        continue;
      }
      // 引用
      if (/^\s*>\s?/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { items.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${inlineMd(items.join(' '))}</blockquote>`);
        continue;
      }
      // 空行分段
      if (!line.trim()) { flushPara(); i++; continue; }
      // 其餘：累積成段落
      para.push(line.trim());
      i++;
    }
    flushPara();
    return out.join('\n');
  } catch {
    return `<pre>${esc(txt(md))}</pre>`;
  }
}

// ============================================================
// renderPreviewHtml — 核可頁：核可對象是檔案，這一頁只是把 gauge.json＋pre-registration.md
// 整理成人看得懂的樣子，不需要跑模型就能出，給人核可用
// ============================================================
const PREVIEW_CHECK_LABEL = {
  'prereg-exists': 'pre-registration.md',
  'say-notsay-found': '可說明／無法說明',
  'has-gate': '前置檢查',
  'has-trap': '陷阱題',
  'has-clean': '乾淨對照題',
  'has-negative': '負向對照題',
  'runs-at-least-3': '次數 ≥3',
  'prompt-mentions-skill-name': '共用指令沒洩題',
  'materials-exist': '材料檔存在',
  'lock-consistent': '鎖定一致',
};
function previewCheckChip(ok) {
  return ok === true ? '<span class="chip ok">✓</span>' : ok === false ? '<span class="chip bad">⚠</span>' : '<span class="chip">–</span>';
}
function previewLockChip(lock) {
  const st = txt(asObj(lock).state);
  return st === 'locked' ? chip('已鎖定', 'ok') : st === 'mismatch' ? chip('已鎖定但不一致', 'bad') : chip('未鎖定', 'warn');
}
function previewLockLine(lock) {
  const l = asObj(lock);
  if (l.state === 'locked') return `已鎖定${nz(l.lockedAt) ? `（${esc(txt(l.lockedAt))}）` : ''}`;
  if (l.state === 'mismatch') return '已鎖定但目前檔案跟鎖定時不一致';
  return '未鎖定';
}

function secPreviewIntro(d) {
  const skill = asObj(d.skill);
  const cond = asObj(d.conditions);
  const cost = asObj(d.cost);
  const lock = asObj(d.lock);
  const checks = asArr(d.checks);
  const okN = checks.filter((c) => asObj(c).ok === true).length;
  const warnN = checks.filter((c) => asObj(c).ok === false).length;
  const skillLine = d.baselineOnly
    ? '（沒有受測 skill——只量基準組做不做得到）'
    : `<code>${esc(nz(txt(skill.name)) || '?')}</code>${nz(skill.path) ? `（<code>${esc(txt(skill.path))}</code>）` : ''}`;
  const p = `<p>量 ${skillLine}——${esc(fmtOr(asArr(d.cases).length))} 題 × ${esc(fmtOr(asArr(d.arms).length))} 組 × ${esc(fmtOr(cond.runs))} 次；估 ${esc(fmtOr(cost.totalCalls))} 次模型呼叫（停案時最少 ${esc(fmtOr(cost.minCallsIfStop))} 次）；鎖定狀態：${previewLockLine(lock)}；自檢 ✓ ${okN} ／ ⚠ ${warnN}。</p>`;
  const chips = [
    nz(cond.executorModel) ? chip(`執行模型 ${txt(cond.executorModel)}`) : null,
    nz(cond.executorEffort) ? chip(`effort ${txt(cond.executorEffort)}`) : null,
    nz(cond.judgeModel) ? chip(`評分模型 ${txt(cond.judgeModel)}`) : null,
    num(cond.runs) !== null ? chip(`每題每組 ${cond.runs} 次`) : null,
    asArr(d.arms).length ? chip(`${asArr(d.arms).length} 組`) : null,
    previewLockChip(lock),
  ].filter(Boolean).join('');
  return section('intro', '先看這裡', p + `<p class="chips">${chips}</p>`);
}

function secPreviewChecks(d) {
  const checks = asArr(d.checks);
  if (!checks.length) return null;
  const rows = checks.map((c) => { const o = asObj(c); return [previewCheckChip(o.ok), esc(PREVIEW_CHECK_LABEL[txt(o.id)] || txt(o.id)), esc(txt(o.text))]; });
  const inner = table(['', '項目', '說明'], rows) +
    `<p class="note">這五條引擎判不了，請你看完題目後自己確認：</p>
<ul class="keypoints">
<li>①題目來自你的翻車案例或 skill 自己的宣稱</li>
<li>②兩組共用的指令沒有洩題（不含 skill 的核心指令詞）</li>
<li>③前置檢查兩組都做得到（不是 skill 教的格式）</li>
<li>④可說明／無法說明你同意</li>
<li>⑤成本可以接受</li>
</ul>`;
  return section('checks', '核可前自檢', inner);
}

function secPreviewConditions(d) {
  const cond = asObj(d.conditions);
  const rows = [
    ['執行模型', esc(nz(txt(cond.executorModel)) || '（帳號預設）')],
    ['effort', nz(cond.executorEffort) ? `<code>${esc(txt(cond.executorEffort))}</code>` : '<span class="muted">未指定</span>'],
    ['評分模型', esc(nz(txt(cond.judgeModel)) || '?')],
    ['每題每組次數', esc(fmtOr(cond.runs))],
    ['可用工具', asArr(cond.allowedTools).length ? asArr(cond.allowedTools).map((x) => `<code>${esc(txt(x))}</code>`).join('、') : '<span class="muted">未限制</span>'],
  ];
  const armRows = asArr(d.arms).map((a) => { const o = asObj(a); return [`<code>${esc(txt(o.name))}</code>`, esc(txt(o.what)), nz(o.path) ? `<code>${esc(txt(o.path))}</code>` : '<span class="muted">—</span>']; });
  const inner = table(['條件', '值'], rows) + (armRows.length ? table(['組', '拿到什麼', '路徑'], armRows) : '');
  return section('conditions', '條件與各組', inner);
}

function secPreviewCases(d) {
  const cases = asArr(d.cases);
  if (!cases.length) return null;
  const rows = cases.map((c) => {
    const o = asObj(c);
    return [`<code>${esc(txt(o.id))}</code>`, esc(nz(txt(o.typeLabel)) || nz(txt(o.type)) || '—'), String(asArr(o.materials).length), String(asArr(o.assertions).length), nz(o.note) ? esc(txt(o.note)) : '<span class="muted">—</span>'];
  });
  const overview = table(['題', '題型', '材料', '檢查項數', '備註'], rows);
  const details = cases.map((c) => {
    const o = asObj(c);
    const summary = `<code>${esc(txt(o.id))}</code> ${esc(nz(txt(o.typeLabel)) || nz(txt(o.type)) || '')}${nz(o.note) ? ` — ${esc(txt(o.note))}` : ''}`;
    const materials = asArr(o.materials).map((m) => {
      const mo = asObj(m);
      const bytesTxt = num(mo.bytes) !== null ? `（${esc(mo.bytes)} bytes）` : '';
      const body = mo.head === null || mo.head === undefined
        ? '<p class="muted">（二進位或讀不出來，沒有內容可顯示）</p>'
        : `<pre>${esc(txt(mo.head))}</pre>${mo.truncated ? '<p class="note">…（只顯示前 600 字）</p>' : ''}`;
      return `<h4>${esc(txt(mo.name))}${bytesTxt}</h4>${body}`;
    }).join('');
    const pr = asObj(o.pressure);
    const pressureHtml = o.pressure
      ? `<h4>壓力測試</h4><dl class="kv">
<dt>規則</dt><dd>${esc(txt(pr.rule))}</dd>
<dt>壓力</dt><dd>${asArr(pr.pressures).map((x) => chip(txt(x))).join('') || '<span class="muted">—</span>'}</dd>
<dt>預期行為</dt><dd>${esc(EXPECTED_BEHAVIOR[txt(pr.expectedBehavior)] || txt(pr.expectedBehavior) || '—')}</dd>
<dt>預期選項</dt><dd>${nz(pr.expectedOption) ? esc(txt(pr.expectedOption)) : '<span class="muted">—</span>'}</dd>
</dl>`
      : '';
    return `<details><summary>${summary}</summary><div class="detail-body">
<h4>兩組共用的指令（逐字）</h4>
<pre>${esc(txt(o.prompt))}</pre>
${asArr(o.materials).length ? `<h4>材料</h4>${materials}` : ''}
${pressureHtml}
</div></details>`;
  }).join('');
  return section('cases', '題組', overview + details);
}

function secPreviewAssertions(d) {
  const list = asArr(d.assertions);
  if (!list.length) return null;
  const order = ['gate', 'fact', 'judgment', 'orientation'];
  const parts = order.map((fam) => {
    const items = list.filter((a) => asObj(a).family === fam);
    if (!items.length) return '';
    const rows = items.map((a) => {
      const o = asObj(a);
      const label = nz(o.label), text = nz(o.text);
      const disp = label != null
        ? `${esc(txt(label))}${text != null && text !== label ? `<div class="small dim">${esc(txt(text))}</div>` : ''}`
        : esc(txt(text));
      return [`<code>${esc(txt(o.id))}</code>`, disp, String(asArr(o.cases).length), o.scored ? '✓' : '–', o.implicit ? '✓' : '–'];
    });
    return `<h3>${esc(nz(txt(asObj(items[0]).familyLabel)) || fam)}</h3>` + table(['id', '文字', '適用題', '計分？', '自動加入？'], rows);
  }).join('');
  return section('assertions', '檢查項', parts);
}

function secPreviewTrigger(trig) {
  if (!isObj(trig)) return null;
  const t = asObj(trig);
  const should = asArr(t.should), shouldNot = asArr(t.shouldNot);
  const listHtml = (arr) => (arr.length ? `<ul>${arr.map((x) => `<li>${esc(txt(x))}</li>`).join('')}</ul>` : '<p class="muted">（沒有列）</p>');
  const inner = `<h3>該觸發（${should.length}）</h3>${listHtml(should)}<h3>不該觸發（${shouldNot.length}）</h3>${listHtml(shouldNot)}`;
  return section('trigger', '觸發題', inner, `每題 ${esc(fmtOr(t.runs))} 次；只在 <code>--with-trigger</code> 或 <code>describe</code> 時才跑。`);
}

function secPreviewMatrix(matrix) {
  const cells = asArr(matrix);
  if (!cells.length) return null;
  const rows = cells.map((c) => { const o = asObj(c); return [esc(nz(txt(o.executorModel)) || '?'), nz(o.effort) ? esc(txt(o.effort)) : '<span class="muted">—</span>']; });
  return section('matrix', '矩陣', table(['執行模型', 'effort'], rows));
}

function secPreviewCost(cost) {
  const c = asObj(cost);
  if (!Object.keys(c).length) return null;
  const rows = [
    ['執行', esc(fmtOr(c.executions))],
    ['評分', esc(fmtOr(c.gradings))],
    ['已知答案檢查', esc(fmtOr(c.isolationChecks))],
    ['評分者自證', esc(fmtOr(c.graderSelfCheck))],
    ['觸發（只在 --with-trigger 才花）', esc(fmtOr(c.triggerRuns))],
    ['矩陣格數', esc(fmtOr(c.matrixCells))],
    ['合計', `<strong>${esc(fmtOr(c.totalCalls))}</strong>`],
  ];
  const inner = table(['項目', '次數'], rows) +
    (nz(c.formula) ? `<p class="note">${esc(txt(c.formula))}</p>` : '') +
    `<p class="note">引擎預設先跑不帶 skill 那組，全過就停案，最少只花 ${esc(fmtOr(c.minCallsIfStop))} 次。</p>`;
  return section('cost', '成本估算', inner);
}

function secPreviewSayNotSay(prereg) {
  const p = asObj(prereg);
  if (!p.exists) return null;
  if (p.say == null && p.notSay == null && p.combined == null) return section('say-notsay', '可說明／無法說明', `<p class="bar">預先登錄裡找不到標題含「可說明」「無法說明」的段落——核可前請補上。</p>`);
  const inner = [
    p.combined != null ? `<div class="bar"><strong>${esc(txt(p.combinedHeading) || '可說明／無法說明')}</strong>${mdToHtml(p.combined)}</div>` : '',
    p.say != null ? `<div class="bar"><strong>可說明</strong>${mdToHtml(p.say)}</div>` : '',
    p.notSay != null ? `<div class="bar"><strong>無法說明</strong>${mdToHtml(p.notSay)}</div>` : '',
  ].join('');
  return section('say-notsay', '可說明／無法說明', inner);
}

function secPreviewFull(prereg) {
  const p = asObj(prereg);
  if (!p.exists) return section('prereg-full', '預先登錄全文', `<p class="bar">找不到 pre-registration.md——lock 會拒絕，除非 --allow-missing-prereg。</p>`);
  return section('prereg-full', '預先登錄全文', `<details open><summary>pre-registration.md 全文（點一下收合）</summary><div class="detail-body">${mdToHtml(p.markdown, { headingOffset: 2 })}</div></details>`);
}

export function renderPreviewHtml(data, opts = {}) {
  const d = asObj(data);
  const name = nz(txt(d.name)) || '（未命名）';
  const title = txt(opts.title || `skill-gauge 核可頁 — ${name}`);
  const cond = asObj(d.conditions);
  const lock = asObj(d.lock);

  const chips = [];
  if (nz(d.generatedAt)) chips.push(chip(`產生時間 ${txt(d.generatedAt)}`));
  if (nz(cond.executorModel)) chips.push(chip(`執行模型 ${txt(cond.executorModel)}${nz(cond.executorEffort) ? ` ／ effort ${txt(cond.executorEffort)}` : ''}`));
  if (nz(cond.judgeModel)) chips.push(chip(`評分模型 ${txt(cond.judgeModel)}`));
  if (asArr(d.arms).length) chips.push(chip(`${asArr(d.arms).length} 組`));
  if (nz(d.engine)) chips.push(chip(`量測引擎 ${txt(d.engine)}`));
  chips.push(previewLockChip(lock));

  const sections = [
    secPreviewIntro(d),
    secPreviewChecks(d),
    secPreviewConditions(d),
    secPreviewCases(d),
    secPreviewAssertions(d),
    secPreviewTrigger(d.trigger),
    secPreviewMatrix(d.matrix),
    secPreviewCost(d.cost),
    secPreviewSayNotSay(d.prereg),
    secPreviewFull(d.prereg),
  ];

  const footer = [
    `<p>這一頁不是核可對象——核可的是檔案。說「可以」之後執行 <code>lock</code>，鎖的是 gauge.json、pre-registration.md、題目、材料、skill 的雜湊；這一頁改了不算數，檔案改了要重出核可頁、重新核可、<code>--relock</code>。</p>`,
    `<p>這一頁由 skill-gauge 的 <code>render.mjs</code> 直接產生：沒有連任何外部資源，可以離線開。</p>`,
  ].join('\n');

  return page({ title, h1: title, chipsHtml: chips.join(''), sections, footerHtml: footer });
}

// ============================================================
// 分派與 CLI
// ============================================================
export function detectKind(data) {
  const d = asObj(data);
  const k = txt(d.kind);
  if (k === 'matrix' || k === 'report' || k === 'describe' || k === 'preview') return k;
  if (Array.isArray(d.combos)) return 'matrix';
  if (Array.isArray(d.rounds) || isObj(d.split)) return 'describe';
  if (isObj(d.prereg) && Array.isArray(d.cases) && !d.totals) return 'preview';
  return 'report';
}

export function renderHtml(data, opts = {}) {
  const kind = detectKind(data);
  if (kind === 'matrix') return renderMatrixHtml(data, opts);
  if (kind === 'describe') return renderDescribeHtml(data, opts);
  if (kind === 'preview') return renderPreviewHtml(data, opts);
  return renderReportHtml(data, opts);
}

function urlToPath(u) {
  let p = txt(u).replace(/^file:\/\//, '');
  try { p = decodeURIComponent(p); } catch {}
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--');
  const src = args[0], out = args[1];
  if (!src || src === '-h' || src === '--help') {
    console.error('用法：node render.mjs <report.json|matrix.json|describe.json> [out.html]');
    process.exit(src ? 0 : 1);
    return;
  }
  const abs = path.resolve(src);
  if (!fs.existsSync(abs)) {
    console.error(`[render] ✗ 找不到檔案：${abs}`);
    process.exit(1);
    return;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    console.error(`[render] ✗ ${abs} 不是合法的 JSON：${e && e.message}`);
    process.exit(1);
    return;
  }
  const outPath = out ? path.resolve(out) : null;
  const html = renderHtml(data, { baseDir: outPath ? path.dirname(outPath) : path.dirname(abs) });
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    console.error(`[render] ${detectKind(data)} → ${outPath}`);
  } else {
    process.stdout.write(html);
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) === path.resolve(urlToPath(import.meta.url)) : false;
if (invoked) main(process.argv.slice(2));
