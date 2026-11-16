/**
 * 全局主题：设计令牌 + 壳 + 通用组件。视图只写自己特有的样式。
 *
 * 规范（视图请遵守）：字号 26/20/16/14/13/12；间距 4/8/12/16/24/32/48；
 * 圆角 卡片6/输入4/徽标3；颜色只用变量，不写死。
 */
export const THEME_CSS = String.raw`
:root{
  color-scheme:light dark;
  --bg:#f6f6f3;--card:#fff;--fg:#171a1e;--muted:#616a75;--line:#e1e2dd;
  --acc:#1c46c8;--acc-soft:#edf1fd;--acc-ink:#16367f;
  --ok:#166534;--ok-soft:#e9f5ee;--danger:#b3261e;--danger-soft:#fbebe9;
  --run:#1c46c8;--run-soft:#edf1fd;
  --row-hover:#f0f1ec;
  --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--s8:64px;
  --fs-2xl:28px;--fs-xl:20px;--fs-lg:16px;--fs:14px;--fs-sm:13px;--fs-xs:12px;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#0f1216;--card:#15191f;--fg:#e6e9ee;--muted:#98a1ad;--line:#272d36;
    --acc:#93b2ff;--acc-soft:#18233c;--acc-ink:#bdd0ff;
    --ok:#5ecb8a;--ok-soft:#12261a;--danger:#f08a82;--danger-soft:#2b1614;
    --run:#93b2ff;--run-soft:#18233c;--row-hover:#1a2028}
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;padding:0}
html{-webkit-tap-highlight-color:transparent}
@media (pointer:fine){html{overscroll-behavior-y:none}}
body{font:var(--fs)/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg)}
h1,h2,h3{margin:0;line-height:1.25;font-weight:600}
h1,.brand{font-family:"Songti SC","SimSun",Georgia,serif;letter-spacing:.01em}
h1{font-size:26px}h2{font-size:var(--fs-lg)}h3{font-size:var(--fs)}
h1,h2{text-wrap:balance}
p{margin:0}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}

/* 壳 */
.app{display:grid;grid-template-columns:200px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:2px;padding:var(--s4) var(--s3);background:var(--card);border-right:1px solid var(--line)}
.brand{font-weight:600;font-size:var(--fs-lg);padding:0 var(--s2) var(--s4);letter-spacing:.2px}
.nav-item{appearance:none;border:0;background:none;color:var(--fg);font:inherit;text-align:left;justify-content:flex-start;padding:8px 10px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:var(--s2)}
.nav-item:hover{background:var(--row-hover)}
.nav-item[aria-current=page]{background:transparent;color:var(--acc-ink);font-weight:600;box-shadow:inset 2px 0 0 var(--acc)}
.nav-item .n{margin-left:auto;font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums}
.nav-n{margin-left:auto;min-width:17px;height:16px;padding:0 4px;border-radius:2px;background:var(--danger);color:#fff;font-size:11px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.side-foot{margin-top:auto;padding-top:var(--s4);border-top:1px solid var(--line);display:flex;flex-direction:column;gap:var(--s2)}
.side-link{font-size:11px;color:var(--muted);word-break:break-all;line-height:1.35}
.side-link:hover{color:var(--acc)}
.main{min-width:0;padding:0 var(--s6) var(--s8)}
.top{position:relative;display:flex;align-items:flex-end;gap:var(--s3);padding:var(--s4) 0 var(--s3);background:var(--bg);border-bottom:1px solid var(--line);margin-bottom:var(--s5)}
.top-t{min-width:0}
.top .sub{color:var(--muted);font-size:var(--fs-sm);margin-top:2px}
.spacer{flex:1}
.view{display:block}

/* 区块与栅格 */
.sec{margin-top:var(--s6);padding-top:var(--s4);border-top:1px solid var(--line)}
.sec:first-child{margin-top:0;padding-top:0;border-top:0}
.sec-head{display:flex;align-items:baseline;gap:var(--s3);margin-bottom:var(--s3);flex-wrap:wrap}
.sec-head .sub{color:var(--muted);font-size:var(--fs-sm)}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:var(--s4)}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s3)}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3)}
.row{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}

/* 文本 */
.sub,.muted{color:var(--muted)}
.sub{font-size:var(--fs-sm)}
.tiny{font-size:var(--fs-xs);color:var(--muted)}
.num{font-variant-numeric:tabular-nums}

/* 表单 */
.field{display:flex;flex-direction:column;gap:var(--s1);font-size:var(--fs-sm);margin:0}
.field>span{color:var(--muted)}
.field.req>span::after{content:" *";color:var(--danger)}
input,select,textarea{font:inherit;font-size:var(--fs);padding:6px 8px;border:1px solid var(--line);border-radius:4px;touch-action:manipulation;background:var(--card);color:var(--fg);width:100%;min-height:36px}
textarea{min-height:auto;resize:vertical}
input[type=checkbox],input[type=radio]{width:auto;min-height:0}
.check{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-sm);cursor:pointer}
.hint{color:var(--muted);font-size:var(--fs-xs);margin-top:var(--s2)}

/* 按钮 */
button,.btn{font:inherit;font-size:var(--fs-sm);min-height:32px;padding:5px 11px;border-radius:4px;touch-action:manipulation;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
button:hover,.btn:hover{background:var(--row-hover)}
button:disabled{opacity:.55;cursor:default}
.primary{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.primary:hover{filter:brightness(1.06);background:var(--acc)}
.danger{color:var(--danger);border-color:var(--danger)}
.ghost{background:transparent}
.btn.sm,button.sm{min-height:28px;padding:3px 8px;font-size:var(--fs-xs)}

/* 徽标 */
.badge{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-xs);padding:1px 6px;border-radius:3px;border:1px solid transparent;color:var(--muted);white-space:nowrap;background:var(--row-hover)}
.badge.ok{color:var(--ok);background:var(--ok-soft)}
.badge.run{color:var(--run);background:var(--run-soft)}
.badge.err{color:var(--danger);background:var(--danger-soft)}
.badge.warn{color:var(--acc-ink);background:var(--acc-soft)}

/* 表格 */
.tbl-wrap{overflow:auto;max-height:calc(100vh - 170px);border:1px solid var(--line);border-radius:6px;background:var(--card)}
.tbl{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.tbl th{position:sticky;top:0;z-index:1;background:var(--card);text-align:left;font-weight:600;font-size:var(--fs-xs);color:var(--muted);padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tbody tr:last-child td{border-bottom:0}
.tbl tbody tr:hover td{background:var(--row-hover)}
.tbl td.num,.tbl th.num{text-align:right;font-variant-numeric:tabular-nums}
.tbl .tx{max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbl .sel{width:36px}

/* 空态与加载 */
.empty{text-align:center;padding:var(--s6) var(--s4);color:var(--muted)}
.empty b{display:block;color:var(--fg);font-weight:600;margin-bottom:var(--s1)}
.empty .btn{margin-top:var(--s3)}
.loading{color:var(--muted);font-size:var(--fs-sm);padding:var(--s4) 0}

/* 抽屉 */
#drawer{position:fixed;inset:0;background:#0007;display:flex;justify-content:flex-end;z-index:30}
#drawer .sheet{background:var(--card);width:min(560px,100%);height:100%;overflow:auto;overscroll-behavior:contain;padding:var(--s5);border-left:1px solid var(--line)}
#drawer .close{float:right}

.skip{position:absolute;left:-9999px;top:0;padding:8px 12px;background:var(--card);border:1px solid var(--line);border-radius:0 0 4px 0;z-index:50}.skip:focus{left:0}

/* toast */
.toast{position:fixed;right:var(--s5);bottom:var(--s5);z-index:40;background:var(--fg);color:var(--bg);padding:10px 14px;border-radius:8px;font-size:var(--fs-sm);max-width:360px}
.toast.err{background:var(--danger);color:#fff}

/* 登录 */
#login{max-width:360px;margin:12vh auto 0}
#login .card{display:flex;flex-direction:column;gap:var(--s3)}
#login h1{font-size:var(--fs-xl)}

/* 移动端 */
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media(max-width:960px){
  html{scroll-padding-top:56px}
  .app{grid-template-columns:1fr}
  .side{position:sticky;top:0;z-index:20;height:auto;flex-direction:row;overflow-x:auto;padding:var(--s2);gap:2px;border-right:0;border-bottom:1px solid var(--line)}
  .brand,.side-foot{display:none}
  .nav-item{white-space:nowrap;padding:6px 10px}
  .main{padding:0 var(--s4) var(--s6)}
  button,.btn,input,select{min-height:40px}
  button.sm,.btn.sm{min-height:34px}
  .top{padding:var(--s3) 0 var(--s2);align-items:center}
  .top .sub{display:none}
  h1{font-size:var(--fs-xl)}
  .grid2,.grid3{grid-template-columns:1fr}
}
@media(max-width:640px){
  .tbl thead{display:none}
  .tbl tbody tr{display:block;border-bottom:1px solid var(--line);padding:var(--s2) 0}
  .tbl td{display:flex;gap:var(--s2);border:0;padding:3px 10px}
  .tbl td::before{content:attr(data-label);color:var(--muted);font-size:var(--fs-xs);min-width:64px;flex:none}
  .tbl .tx{max-width:none;white-space:normal}
}
`;
