import type { View } from '../types.js'

/**
 * 用户管理（仅 admin）：每个账号每天的关键词、评论、群发、沟通与占用。
 *
 * 结构：工具栏（天数 / 用户 / 刷新 / 更新时间）→ 台账式 4 汇总 → 按天明细（每行可展开看当天的任务 / 线索 / 发送 / 会话）→ 账号概览。
 * 视图 js 与其它视图共享全局作用域，函数 / 变量 / id / class 一律 admin 前缀。
 */
export const admin: View = {
  id: 'admin',
  nav: '用户管理',
  title: '用户管理',
  sub: '每个账号每天抓了哪些关键词、采了多少评论、发了多少消息。',
  css: String.raw`
/* ---- view: admin ---- */
.admin-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--s3);padding:var(--s3) var(--s4)}
.admin-bar .field{flex:0 0 auto}
.admin-f-days{width:132px}
.admin-f-user{width:180px}
.admin-bar .spacer{flex:1 1 24px}
.admin-stamp{align-self:center;white-space:nowrap;font-variant-numeric:tabular-nums}

.admin-err{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap;border-color:var(--danger);margin-top:var(--s4)}
.admin-err b{color:var(--danger)}
.admin-err .sub{flex:1 1 220px;min-width:0}

/* 汇总：一条带分隔线的台账，不是四张圆角卡 */
.admin-ledger-head{display:flex;align-items:baseline;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s5);font-size:var(--fs-xs);color:var(--muted)}
.admin-ledger-head b{font-size:var(--fs-sm);font-weight:600;color:var(--fg);letter-spacing:.02em}
.admin-ledger{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:6px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.admin-cell{display:flex;flex-direction:column;gap:1px;min-width:0;padding:12px var(--s4) 13px;border-left:1px solid var(--line)}
.admin-cell:first-child{border-left:0;padding-left:0}
.admin-cell-k{display:flex;align-items:baseline;gap:6px;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-cell-k i{font-style:normal;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;letter-spacing:.04em;opacity:.66}
.admin-cell-n{font-size:28px;line-height:1.12;font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.admin-cell-s{font-size:var(--fs-xs);color:var(--muted);line-height:1.35;min-height:1.35em}
.admin-cell.is-zero .admin-cell-n{color:var(--muted)}

/* 表格 */
.admin-tbl-wrap{overflow:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}
.admin-tbl-wrap.admin-scroll{max-height:min(58vh,560px)}
.admin-tbl{table-layout:fixed;width:100%}
.admin-tbl-day{min-width:760px}
.admin-tbl-use{min-width:900px}
.admin-tbl-day col.admin-c1{width:118px}
.admin-tbl-day col.admin-c2{width:132px}
.admin-tbl-day col.admin-c3{width:auto}
.admin-tbl-day col.admin-c4,
.admin-tbl-day col.admin-c5,
.admin-tbl-day col.admin-c6{width:64px}
.admin-tbl-day col.admin-c7{width:88px}
.admin-tbl-day col.admin-c8{width:68px}
.admin-tbl-use col.admin-u1{width:132px}
.admin-tbl-use col.admin-u2{width:84px}
.admin-tbl-use col.admin-u3{width:72px}
.admin-tbl-use col.admin-u4{width:82px}
.admin-tbl-use col.admin-u5{width:64px}
.admin-tbl-use col.admin-u6{width:64px}
.admin-tbl-use col.admin-u7{width:84px}
.admin-tbl-use col.admin-u8{width:76px}
.admin-tbl-use col.admin-u9{width:118px}
.admin-tbl-use col.admin-u10{width:140px}
.admin-pad{padding:var(--s4)}

.admin-kws{display:flex;flex-wrap:wrap;gap:4px}
.admin-kw{display:inline-block;max-width:168px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-xs);line-height:1.6;padding:0 5px;border-radius:3px;border:1px solid var(--line);background:var(--row-hover);color:var(--fg)}
.admin-kw.admin-more{background:transparent;border:1px dashed var(--line);color:var(--muted)}
.admin-dash{color:var(--muted)}
.admin-zero{color:var(--muted)}
.admin-date{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.admin-today{font-size:10px;line-height:1.6;padding:0 4px;border-radius:3px;background:var(--acc-soft);color:var(--acc-ink)}
.admin-io b{display:block;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.admin-when{white-space:nowrap;font-variant-numeric:tabular-nums;font-size:var(--fs-xs)}

.admin-sum{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s4);margin-top:var(--s3);font-size:var(--fs-xs);color:var(--muted)}
.admin-sum b{color:var(--fg);font-weight:600;font-variant-numeric:tabular-nums}

/* 数据清理：amber 提示 + 汇总行 + 危险区 */
.admin-clean{--amber-ink:#8a5a00;--amber-soft:#fdf6e5;--amber-line:#e3c88f}
@media (prefers-color-scheme:dark){.admin-clean{--amber-ink:#f2c983;--amber-soft:#2a2114;--amber-line:#4b3a1a}}
.admin-f-keep{width:132px}
.admin-clean-note{display:flex;align-items:baseline;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s3);padding:9px var(--s3) 10px;border:1px solid var(--line);border-radius:4px;background:var(--card);font-size:var(--fs-sm);line-height:1.55}
.admin-clean-note b{font-weight:600;font-variant-numeric:tabular-nums}
.admin-clean-note.is-hit{border-color:var(--amber-line);background:var(--amber-soft);color:var(--amber-ink)}
.admin-clean-note.is-hit b{color:var(--amber-ink)}
.admin-clean-note.is-clear{border-color:var(--line);background:var(--ok-soft);color:var(--ok)}
.admin-clean-note.is-clear b{color:var(--ok)}
.admin-clean-tbl{min-width:780px}
.admin-clean-tbl col.admin-q1{width:auto}
.admin-clean-tbl col.admin-q2{width:96px}
.admin-clean-tbl col.admin-q3{width:104px}
.admin-clean-tbl col.admin-q4{width:104px}
.admin-clean-tbl col.admin-q5{width:132px}
.admin-clean-tbl col.admin-q6{width:96px}
.admin-clean-tbl tfoot td{padding:8px 10px;border-top:1px solid var(--line);border-bottom:0;background:var(--card);font-size:var(--fs-xs);color:var(--muted)}
.admin-clean-tbl tfoot td b{color:var(--fg);font-size:var(--fs-sm);font-weight:600;font-variant-numeric:tabular-nums}

.admin-danger{margin-top:var(--s3);border-color:var(--danger);display:flex;flex-direction:column;gap:var(--s2)}
.admin-danger-h{display:flex;align-items:baseline;gap:var(--s2);flex-wrap:wrap}
.admin-danger-h b{font-size:var(--fs-sm);font-weight:600;letter-spacing:.02em;color:var(--danger)}
.admin-danger-txt{line-height:1.6}
.admin-danger-txt b{color:var(--fg);font-weight:600}
.admin-danger-act{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s1)}
.admin-danger-msg{font-size:var(--fs-xs);color:var(--muted);min-width:0;word-break:break-word}
.admin-danger-msg.is-ok{font-size:var(--fs-sm);color:var(--ok);font-weight:600}
.admin-danger-msg.is-bad{font-size:var(--fs-sm);color:var(--danger)}
.admin-confirm{display:flex;align-items:flex-end;gap:var(--s2);flex-wrap:wrap;padding-top:var(--s3);border-top:1px dashed var(--line)}
.admin-confirm .field{width:200px}
.admin-confirm input{min-height:32px;font-size:var(--fs-sm)}
.admin-confirm .tiny{flex:1 1 100%;min-width:0;padding-bottom:0;line-height:1.45}

/* 按天明细：行内展开（紧凑四组，不做大卡片） */
.admin-day-row{cursor:pointer}
.admin-day-row.is-open td{background:var(--row-hover)}
.admin-day-op{text-align:right;padding-left:0}
.admin-day-btn{white-space:nowrap}
.admin-day-x>td,.admin-tbl tbody tr.admin-day-x:hover>td{padding:0;background:var(--bg);border-bottom:1px solid var(--line)}
.admin-dayx{padding:var(--s1) var(--s3) var(--s3)}
.admin-dayx-h{display:flex;align-items:baseline;gap:var(--s2);flex-wrap:wrap;padding:var(--s1) 0 var(--s2)}
.admin-dayx-h b{font-size:var(--fs-sm);font-weight:600;font-variant-numeric:tabular-nums}
.admin-dayx-note{white-space:nowrap}
.admin-dayx-load{margin:0;padding:var(--s2) 0}
.admin-dayx-bad{color:var(--danger)}
.admin-dayx-err{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;padding:var(--s2) 0}
.admin-dayx-err b{color:var(--danger);font-size:var(--fs-sm)}
.admin-dayx-err .sub{flex:1 1 200px;min-width:0;word-break:break-word}

.admin-dgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s3) var(--s5)}
.admin-dg{min-width:0}
.admin-dg-leads,.admin-dg-chats{grid-column:1/-1}
.admin-dg-h{display:flex;align-items:baseline;gap:6px;padding-bottom:3px;border-bottom:1px solid var(--line)}
.admin-dg-h b{font-size:var(--fs-xs);font-weight:600;letter-spacing:.03em}
.admin-dg-meta{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.admin-dg-b{display:flex;flex-direction:column;max-height:212px;overflow:auto;overscroll-behavior:contain}
.admin-dg-none{margin:0;padding:6px 0;font-size:var(--fs-xs);color:var(--muted)}
.admin-dg-more{margin:0;padding:5px 0 0;font-size:11px;color:var(--muted)}
.admin-dg-t{font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums}
.admin-dg-li{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;min-width:0;padding:4px 0;border-bottom:1px solid var(--line)}
.admin-dg-li:last-child{border-bottom:0}
.admin-dg-li .admin-kws{flex:1 1 140px;min-width:0}
.admin-dg-io{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
.admin-dg-io b{color:var(--fg);font-weight:600}
.admin-dgr{display:grid;align-items:baseline;gap:0 var(--s3);min-width:0;padding:4px 0;border-bottom:1px solid var(--line)}
.admin-dgr:last-child{border-bottom:0}
.admin-dgr>span{min-width:0;font-size:var(--fs-xs)}
.admin-dgr-hx{position:sticky;top:0;z-index:1;background:var(--bg);border-bottom:1px solid var(--line)}
.admin-dgr-hx>span{font-size:11px;color:var(--muted);letter-spacing:.02em}
.admin-dgr-lead{grid-template-columns:92px minmax(0,1fr) 56px 126px minmax(0,148px)}
.admin-dgr-sent{grid-template-columns:38px 54px minmax(0,1fr) 60px 46px}
.admin-dgr-chat{grid-template-columns:38px 44px minmax(0,118px) minmax(0,1fr)}
.admin-e{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.admin-dgc{display:flex;flex-wrap:wrap;gap:2px 4px;min-width:0}
.admin-ctb{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.5;padding:0 4px;border:1px solid var(--line);border-radius:3px;background:var(--card);color:var(--fg)}

@media(max-width:1100px){
  .admin-tbl-day{min-width:0}
  .admin-tbl-use{min-width:820px}
  .admin-clean-tbl{min-width:680px}
}
@media(max-width:960px){
  .admin-ledger{grid-template-columns:repeat(2,minmax(0,1fr))}
  .admin-cell:nth-child(3){border-left:0;padding-left:0}
  .admin-cell:nth-child(n+3){border-top:1px solid var(--line)}
  .admin-tbl-wrap.admin-scroll{max-height:none}
  .admin-dgrid{grid-template-columns:minmax(0,1fr)}
  .admin-dg-leads,.admin-dg-chats{grid-column:auto}
  .admin-dg-b{max-height:none}
  .admin-dgr-lead{grid-template-columns:84px minmax(0,1fr) 52px 104px}
  .admin-dgr-lead>span:nth-child(5){display:none}
}
@media(max-width:640px){
  .admin-f-days,.admin-f-user{width:100%}
  .admin-tbl{min-width:0;table-layout:auto}
  .admin-tbl col{width:auto}
  .admin-cell-n{font-size:24px}
  .admin-cell{padding:10px var(--s3) 11px}
  .admin-kw{max-width:none}
  .admin-tbl-wrap{border-color:transparent}
  .admin-dayx{padding:var(--s1) var(--s2) var(--s2)}
  .admin-dgr-lead{grid-template-columns:80px minmax(0,1fr) 96px}
  .admin-dgr-lead>span:nth-child(3){display:none}
  .admin-dgr-sent{grid-template-columns:34px 48px minmax(0,1fr) 52px 42px}
  .admin-dgr-chat{grid-template-columns:34px 42px minmax(0,84px) minmax(0,1fr)}
  .admin-clean-tbl{min-width:0}
  .admin-confirm .field{width:100%}
  .admin-clean-note{padding:8px var(--s2) 9px}
}
`,
  html: String.raw`<section class="sec">
  <div class="card admin-bar">
    <label class="field admin-f-days"><span>统计天数</span>
      <select id="adminDays">
        <option value="7">近 7 天</option>
        <option value="14" selected>近 14 天</option>
        <option value="30">近 30 天</option>
      </select>
    </label>
    <label class="field admin-f-user"><span>用户</span>
      <select id="adminUser"><option value="">全部用户</option></select>
    </label>
    <button class="btn ghost" type="button" id="adminRefresh">刷新</button>
    <span class="spacer"></span>
    <span class="tiny admin-stamp" id="adminStamp" role="status" aria-live="polite">—</span>
  </div>

  <div class="card admin-err" id="adminErr" hidden></div>

  <div class="admin-ledger-head"><b>本期台账</b><span id="adminLedgerScope">近 14 天 · 全部用户</span></div>
  <div class="admin-ledger">
    <div class="admin-cell">
      <span class="admin-cell-k"><i>01</i>活跃账号数</span>
      <b class="admin-cell-n num" id="adminActive">—</b>
      <span class="admin-cell-s" id="adminActiveSub">读取中…</span>
    </div>
    <div class="admin-cell">
      <span class="admin-cell-k"><i>02</i>本期评论总数</span>
      <b class="admin-cell-n num" id="adminComments">—</b>
      <span class="admin-cell-s" id="adminCommentsSub">读取中…</span>
    </div>
    <div class="admin-cell">
      <span class="admin-cell-k"><i>03</i>本期群发总数</span>
      <b class="admin-cell-n num" id="adminSent">—</b>
      <span class="admin-cell-s" id="adminSentSub">读取中…</span>
    </div>
    <div class="admin-cell">
      <span class="admin-cell-k"><i>04</i>沟通客户数</span>
      <b class="admin-cell-n num" id="adminCustomers">—</b>
      <span class="admin-cell-s" id="adminCustomersSub">按会话对象去重</span>
    </div>
  </div>
</section>

<section class="sec">
  <div class="sec-head"><h2>按天明细</h2><span class="sub" id="adminDaysSub">日期倒序，只列有记录的行。</span></div>
  <div class="admin-tbl-wrap admin-scroll" id="adminDayWrap" role="region" aria-label="按天明细"><p class="loading admin-pad">读取中…</p></div>
</section>

<section class="sec">
  <div class="sec-head"><h2>账号概览</h2><span class="sub">累计作品、线索、私信与磁盘占用，按账号统计。</span></div>
  <div class="admin-tbl-wrap" id="adminUsageWrap" role="region" aria-label="账号概览"><p class="loading admin-pad">读取中…</p></div>
  <div class="admin-sum" id="adminUsageSum"></div>
</section>

<section class="sec">
  <div class="sec-head"><h2>群发参数</h2><span class="sub">单日上限、一次最多、发送间隔；所有账号共用，采集页的候选群发按这里的值执行。</span></div>
  <form class="card" id="adminSendForm">
    <div class="grid2" style="margin-top:2px">
      <label class="field"><span>单日上限（条）</span><input id="adminSendCap" type="number" min="1" max="200" step="1"></label>
      <label class="field"><span>一次最多（条）</span><input id="adminSendBatch" type="number" min="1" max="200" step="1"></label>
      <label class="field"><span>最小间隔（秒）</span><input id="adminSendMin" type="number" min="5" step="1"></label>
      <label class="field"><span>最大间隔（秒）</span><input id="adminSendMax" type="number" min="5" step="1"></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="primary" id="adminSendSave" type="submit">保存</button>
      <span class="tiny" id="adminSendMsg" role="status" aria-live="polite"></span>
    </div>
    <p class="hint">单日上限与一次最多 1-200；间隔最小 5 秒，最大间隔不能小于最小间隔。默认 25 条/天、一次 50 条、30-90 秒。</p>
  </form>
</section>

<section class="sec admin-clean">
  <div class="sec-head"><h2>数据清理</h2><span class="sub">删掉超过保留期、且从未被任何筛选词命中的评论正文，腾出磁盘空间。</span></div>
  <div class="card admin-bar">
    <label class="field admin-f-keep"><span>保留天数</span>
      <select id="adminCleanDays">
        <option value="7">7 天</option>
        <option value="30" selected>30 天</option>
        <option value="90">90 天</option>
      </select>
    </label>
    <button class="btn ghost" type="button" id="adminCleanPreview">预览</button>
    <span class="spacer"></span>
    <span class="tiny admin-stamp" id="adminCleanStamp" role="status" aria-live="polite">—</span>
  </div>

  <div class="admin-clean-note" id="adminCleanNote" role="status" aria-live="polite" hidden></div>
  <div class="admin-tbl-wrap" id="adminCleanWrap" role="region" aria-label="可清理评论预览"><p class="loading admin-pad">读取中…</p></div>

  <div class="card admin-danger">
    <div class="admin-danger-h"><b>危险区</b><span class="tiny">清理后不可撤销</span></div>
    <p class="sub admin-danger-txt">执行后会删除超过所选天数、且从未被任何筛选词（词库 + 历史用过的词）命中的评论正文，只删原始评论数据行，<b>会保留：线索库、发送记录、会话、断点状态</b>。重跑采集会跳过已删掉的评论，不会重复抓取。</p>
    <div class="admin-danger-act">
      <button class="btn danger" type="button" id="adminCleanRun">执行清理</button>
      <span class="admin-danger-msg" id="adminCleanMsg" role="status" aria-live="polite"></span>
    </div>
    <div class="admin-confirm" id="adminCleanConfirm" hidden>
      <label class="field"><span>输入「确认清理」再执行</span>
        <input id="adminCleanInput" type="text" autocomplete="off" spellcheck="false" placeholder="确认清理">
      </label>
      <button class="btn danger" type="button" id="adminCleanOk" disabled>确认执行清理</button>
      <button class="btn sm ghost" type="button" id="adminCleanCancel">取消</button>
      <span class="tiny">这一步会真的删数据：先点「预览」确认条数与体积，再输入「确认清理」。</span>
    </div>
  </div>
</section>

<section class="sec admin-clean">
  <div class="sec-head"><h2>共享内容库</h2><span class="sub">所有账号共用的内容：作品、评论、媒体各存一份。这里看体积与复用率，并回收没人引用的旧内容。</span></div>
  <div class="card admin-bar">
    <label class="field admin-f-keep"><span>回收超过</span>
      <select id="adminGcDays">
        <option value="7">7 天</option>
        <option value="30" selected>30 天</option>
        <option value="90">90 天</option>
        <option value="180">180 天</option>
      </select>
    </label>
    <button class="btn ghost" type="button" id="adminGcPreview">预览回收</button>
    <span class="spacer"></span>
    <span class="tiny admin-stamp" id="adminGcStamp" role="status" aria-live="polite">—</span>
  </div>

  <div class="card" id="adminLibStats"><p class="loading admin-pad">读取中…</p></div>
  <div class="admin-tbl-wrap" id="adminGcWrap" role="region" aria-label="共享库回收预览"><p class="hint admin-pad">点「预览回收」看没有引用、且超过保留期的作品。</p></div>

  <div class="card admin-danger">
    <div class="admin-danger-h"><b>危险区</b><span class="tiny">回收后不可恢复</span></div>
    <p class="sub admin-danger-txt">只删除<b>没有任何用户引用</b>（没人采到过，或引用已被清空）、且超过保留期没再出现的作品、它的评论，以及不再被任何作品引用的媒体字节。<b>被任何账号引用过的内容一条都不会动。</b></p>
    <div class="admin-danger-act">
      <button class="btn danger" type="button" id="adminGcRun">执行回收</button>
      <span class="admin-danger-msg" id="adminGcMsg" role="status" aria-live="polite"></span>
    </div>
    <div class="admin-confirm" id="adminGcConfirm" hidden>
      <label class="field"><span>输入「确认回收」再执行</span>
        <input id="adminGcInput" type="text" autocomplete="off" spellcheck="false" placeholder="确认回收">
      </label>
      <button class="btn danger" type="button" id="adminGcOk" disabled>确认执行回收</button>
      <button class="btn sm ghost" type="button" id="adminGcCancel">取消</button>
      <span class="tiny">先「预览回收」确认条数与体积，再输入「确认回收」。</span>
    </div>
  </div>
</section>`,
  js: String.raw`
/* ---- view: admin ---- */
(function(){
  var adminDaysDefault=14;
  var adminState={days:adminDaysDefault,user:'',busy:false,seq:0,activity:null,usage:null,activityErr:'',usageErr:'',stamp:'',open:null,detail:{}};
  /** 数据清理：独立一套状态，不与上面的统计天数 / 用户筛选联动。 */
  var adminCleanDefault=30;
  var adminClean={days:adminCleanDefault,busy:false,run:false,seq:0,data:null,err:'',stamp:'',stage:'idle',msg:'',msgKind:''};

  /** 行内展开用到的名字表与条数上限（单日数据可能很长，超出就截断并注明）。 */
  var adminPlatName={xhs:'小红书',douyin:'抖音',kuaishou:'快手',bilibili:'B 站',weibo:'微博',tiktok:'TikTok',x:'X'};
  var adminTypeName={search:'搜索',detail:'作品详情',creator:'创作者'};
  var adminKindName={dm:'私信',reply:'评论回复'};
  var adminCtName={phone:'电话',wechat:'微信',qq:'QQ'};
  var adminLeadMax=50,adminSentMax=50,adminChatMax=50;

  /* ---------------------------------------------------------------- 小工具 */
  function adminPad(n){return (n<10?'0':'')+n}
  function adminClock(){var d=new Date();return adminPad(d.getHours())+':'+adminPad(d.getMinutes())}
  function adminDateStr(d){return d.getFullYear()+'-'+adminPad(d.getMonth()+1)+'-'+adminPad(d.getDate())}
  function adminToday(){return adminDateStr(new Date())}
  function adminYesterday(){return adminDateStr(new Date(Date.now()-86400000))}
  function adminWindowText(){return '近 '+adminState.days+' 天'}
  function adminScopeText(){return adminWindowText()+' · '+(adminState.user||'全部用户')}
  function adminErrText(e){return e&&e.message?String(e.message):String(e||'未知错误')}

  /** KB / MB 两档为主，极大值再升 GB。 */
  function adminBytes(v){
    var n=Number(v);
    if(!isFinite(n)||n<=0)return '0 KB';
    if(n<1024)return Math.round(n)+' B';
    var kb=n/1024;
    if(kb<1024)return (kb<10?kb.toFixed(1):String(Math.round(kb)))+' KB';
    var mb=kb/1024;
    if(mb<1024)return (mb<10?mb.toFixed(1):String(Math.round(mb)))+' MB';
    return (mb/1024).toFixed(1)+' GB';
  }

  /** 最近活跃统一按本地时区 YYYY-MM-DD HH:mm。 */
  function adminTimeText(iso){
    if(!iso)return '—';
    var d=new Date(iso);
    if(!d.getTime()||isNaN(d.getTime())){var s=fmtTime(iso);return s||'—'}
    return adminDateStr(d)+' '+adminPad(d.getHours())+':'+adminPad(d.getMinutes());
  }

  function adminStatusBadge(st){
    var s=String(st||'active');
    if(s==='pending')return '<span class="badge warn">待审核</span>';
    if(s==='disabled')return '<span class="badge err">已停用</span>';
    if(s==='active')return '<span class="badge ok">正常</span>';
    return '<span class="badge">'+esc(s)+'</span>';
  }

  function adminRoleBadge(role){
    return String(role||'user')==='admin'
      ?'<span class="badge warn">admin</span>'
      :'<span class="badge">user</span>';
  }

  /** 0 压成灰色，别让整列都是黑数字。 */
  function adminNumCell(v){
    var n=Number(v)||0;
    if(n<=0)return '<span class="admin-zero">0</span>';
    return num(n);
  }

  /** 关键词小标签：最多 5 个，其余折成「+N 个」，悬停看全。 */
  function adminKeywords(list){
    var words=(Array.isArray(list)?list:[]).map(function(w){return String(w==null?'':w).trim()}).filter(function(w){return !!w});
    if(!words.length)return '<span class="admin-dash">—</span>';
    var max=5;
    var shown=words.slice(0,max);
    var rest=words.slice(max);
    var html=shown.map(function(w){
      return '<span class="admin-kw" title="'+esc(w)+'">'+esc(w)+'</span>';
    }).join('');
    if(rest.length)html+='<span class="admin-kw admin-more" title="'+esc(rest.join(' / '))+'">+'+rest.length+' 个</span>';
    return '<span class="admin-kws">'+html+'</span>';
  }

  /* ---------------------------------------------------------------- 数据整理 */
  /** 拍平成「一行 = 一天 × 一个账号」，只留有记录的行，日期倒序。 */
  function adminDayRows(){
    var only=adminState.user;
    var out=[];
    (Array.isArray(adminState.activity)?adminState.activity:[]).forEach(function(u){
      if(!u)return;
      var name=String(u.username||'');
      if(only&&name!==only)return;
      (Array.isArray(u.days)?u.days:[]).forEach(function(d){
        if(!d)return;
        var customers=Array.isArray(d.customers)?d.customers:[];
        var items=Number(d.items)||0;
        var comments=Number(d.comments)||0;
        var sent=Number(d.sent)||0;
        var cust=customers.length;
        if(items<=0&&comments<=0&&sent<=0&&cust<=0)return;
        out.push({date:String(d.date||''),username:name,keywords:d.keywords,items:items,comments:comments,sent:sent,customers:cust,total:items+comments+sent+cust});
      });
    });
    out.sort(function(a,b){
      if(a.date!==b.date)return a.date<b.date?1:-1;
      if(a.total!==b.total)return b.total-a.total;
      return a.username<b.username?-1:(a.username>b.username?1:0);
    });
    return out;
  }

  /** 4 个汇总：只算当前筛选范围，沟通客户按会话对象全局去重。 */
  function adminLedgerAgg(){
    var only=adminState.user;
    var agg={accounts:0,active:0,comments:0,sent:0,customers:0};
    var peers={};
    (Array.isArray(adminState.activity)?adminState.activity:[]).forEach(function(u){
      if(!u)return;
      if(only&&String(u.username||'')!==only)return;
      agg.accounts++;
      var t=u.totals||{};
      if((Number(t.activeDays)||0)>0)agg.active++;
      agg.comments+=Number(t.comments)||0;
      agg.sent+=Number(t.sent)||0;
      (Array.isArray(u.days)?u.days:[]).forEach(function(d){
        if(!d)return;
        (Array.isArray(d.customers)?d.customers:[]).forEach(function(peer){
          var key=String(peer==null?'':peer);
          if(!key||Object.prototype.hasOwnProperty.call(peers,key))return;
          peers[key]=1;
          agg.customers++;
        });
      });
    });
    return agg;
  }

  function adminUsageRows(){
    var only=adminState.user;
    var rows=(Array.isArray(adminState.usage)?adminState.usage:[]).filter(function(u){
      return !!u&&(!only||String(u.username||'')===only);
    });
    rows.sort(function(a,b){return String(a.username||'').localeCompare(String(b.username||''),'zh-Hans')});
    return rows;
  }

  /* ---------------------------------------------------------------- 渲染：汇总 */
  function adminCellSet(id,value,sub,zero){
    var el=$(id);if(!el)return;
    el.textContent=String(value);
    var cell=el.parentNode;
    if(cell&&cell.classList)cell.classList.toggle('is-zero',!!zero);
    var s=$(id+'Sub');if(s)s.textContent=sub;
  }

  function adminRenderLedger(){
    var scope=$('#adminLedgerScope');if(scope)scope.textContent=adminScopeText();
    if(adminState.activity===null){
      var why=adminState.activityErr?'没取到数据':'读取中…';
      adminCellSet('#adminActive','—',why,true);
      adminCellSet('#adminComments','—',why,true);
      adminCellSet('#adminSent','—',why,true);
      adminCellSet('#adminCustomers','—',why,true);
      return;
    }
    var agg=adminLedgerAgg();
    adminCellSet('#adminActive',num(agg.active),'有记录的账号，共 '+agg.accounts+' 个',agg.active<=0);
    adminCellSet('#adminComments',num(agg.comments),adminWindowText()+'入库的评论条数',agg.comments<=0);
    adminCellSet('#adminSent',num(agg.sent),'发送成功的私信条数',agg.sent<=0);
    adminCellSet('#adminCustomers',num(agg.customers),'按会话对象去重',agg.customers<=0);
  }

  /* ---------------------------------------------------------------- 渲染：按天明细 */
  function adminEmptyHtml(){
    var who=adminState.user?('「'+esc(adminState.user)+'」'):'所有账号';
    return '<div class="empty">'
      +'<b>还没有采集或发送记录</b>'
      +'<p class="sub">'+esc(adminWindowText())+'里'+who+'都没有关键词采集、评论入库或私信发送。去「采集」跑一轮关键词，回来这里就能按天对账。</p>'
      +'<button class="btn" type="button" data-admin-go="crawl">去采集</button>'
      +'</div>';
  }

  /* ---------------------------------------------------------------- 渲染：行内展开（当天明细） */
  /** 行 key = 用户名 + 日期；用户名只含 [a-z0-9_-] 或中文，不会撞分隔符。 */
  function adminDayKey(user,date){return String(user||'')+'|'+String(date||'')}

  function adminDaySplit(key){
    var s=String(key||''),at=s.indexOf('|');
    if(at<0)return null;
    var user=s.slice(0,at),date=s.slice(at+1);
    if(!user||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return null;
    return {key:s,username:user,date:date};
  }

  function adminDayRowEl(key){
    var safe=String(key||'').split('"').join('').split('\\').join('');
    return $('#adminDayWrap tr[data-admin-day="'+safe+'"]');
  }
  function adminDayXEl(){return $('#adminDayX')}
  function adminDayIsOpen(ref){return !!(adminState.open&&ref&&adminState.open.key===ref.key)}

  /** 当天只留 HH:mm；时间戳解析不了就退回 fmtTime 的尾部。 */
  function adminHm(iso){
    var s=String(iso||'');
    if(!s)return '—';
    var d=new Date(s);
    if(isNaN(d.getTime())){var f=fmtTime(s);return f.slice(-5)||'—'}
    return adminPad(d.getHours())+':'+adminPad(d.getMinutes());
  }
  function adminPlat(id){var k=String(id||'');return adminPlatName[k]||k||'—'}
  function adminKind(id){var k=String(id||'');return adminKindName[k]||k||'—'}

  function adminJobBadge(st){
    var s=String(st||'');
    if(s==='done')return '<span class="badge ok">完成</span>';
    if(s==='error')return '<span class="badge err">失败</span>';
    if(s==='stopped')return '<span class="badge warn">已停止</span>';
    if(s==='running')return '<span class="badge run">进行中</span>';
    return '<span class="badge">'+esc(s||'—')+'</span>';
  }
  function adminOkBadge(ok){
    return ok?'<span class="badge ok">成功</span>':'<span class="badge err">失败</span>';
  }

  function adminDg(kind,title,meta,body){
    return '<section class="admin-dg admin-dg-'+kind+'">'
      +'<div class="admin-dg-h"><b>'+title+'</b><span class="admin-dg-meta">'+esc(meta)+'</span></div>'
      +'<div class="admin-dg-b">'+body+'</div>'
      +'</section>';
  }
  function adminDgNone(){return '<p class="admin-dg-none">无</p>'}
  function adminDgMore(text){return '<p class="admin-dg-more">'+esc(text)+'</p>'}

  /** 联系方式小标签，最多 3 个，其余折成 +N。 */
  function adminContacts(list){
    var raw=Array.isArray(list)?list:[],out=[];
    for(var i=0;i<raw.length;i++){
      var c=raw[i];
      if(!c||c.value==null||c.value==='')continue;
      var type=adminCtName[String(c.type)]||String(c.type||'');
      var text=(type?type+' ':'')+String(c.value);
      out.push('<span class="admin-ctb" title="'+esc(text)+'">'+esc(text)+'</span>');
    }
    if(!out.length)return '<span class="admin-dash">—</span>';
    if(out.length<=3)return out.join('');
    return out.slice(0,3).join('')+'<span class="admin-ctb" title="其余 '+(out.length-3)+' 个">+'+(out.length-3)+'</span>';
  }

  function adminDgJobs(list){
    var body='';
    if(!list.length)body=adminDgNone();
    else{
      body=list.slice(0,adminSentMax).map(function(job){
        job=job||{};
        var items=Number(job.items)||0,comments=Number(job.comments)||0;
        return '<div class="admin-dg-li">'
          +'<span class="admin-dg-t">'+esc(adminHm(job.at))+'</span>'
          +'<span class="badge">'+esc(adminTypeName[String(job.type)]||String(job.type||'')||'—')+'</span>'
          +'<span class="badge">'+esc(adminPlat(job.platform))+'</span>'
          +adminKeywords(job.keywords)
          +'<span class="admin-dg-io num">作品 <b>'+items+'</b> · 评论 <b>'+comments+'</b></span>'
          +adminJobBadge(job.status)
          +'</div>';
      }).join('');
      if(list.length>adminSentMax)body+=adminDgMore('另有 '+(list.length-adminSentMax)+' 条任务未显示');
    }
    return adminDg('jobs','当天任务',list.length+' 条',body);
  }

  function adminDgLeads(list){
    var shown=list.slice(0,adminLeadMax),body='';
    if(!shown.length)body=adminDgNone();
    else{
      body='<div class="admin-dgr admin-dgr-hx admin-dgr-lead"><span>评论者</span><span>评论</span><span>地域</span><span>联系方式</span><span>来源作品</span></div>'
        +shown.map(function(lead){
          lead=lead||{};
          var who=String(lead.author_name||'');
          var text=String(lead.text||'');
          var prov=String(lead.province||'');
          var src=String(lead.item_title||lead.item_id||'');
          return '<div class="admin-dgr admin-dgr-lead">'
            +'<span class="admin-e" title="'+esc(who)+'">'+(who?esc(who):'<span class="admin-dash">—</span>')+'</span>'
            +'<span class="admin-e" title="'+esc(text)+'">'+(text?esc(text):'<span class="admin-dash">—</span>')+'</span>'
            +'<span class="admin-e" title="'+esc(prov)+'">'+(prov?esc(prov):'<span class="admin-dash">—</span>')+'</span>'
            +'<span class="admin-dgc">'+adminContacts(lead.contacts)+'</span>'
            +'<span class="admin-e" title="'+esc(src)+'">'+(src?esc(src):'<span class="admin-dash">—</span>')+'</span>'
            +'</div>';
        }).join('');
      if(list.length>shown.length)body+=adminDgMore('共 '+list.length+' 条，只显示前 '+shown.length+' 条');
    }
    return adminDg('leads','当天线索',list.length+' 条',body);
  }

  function adminDgSent(list){
    var shown=list.slice(0,adminSentMax),body='';
    if(!shown.length)body=adminDgNone();
    else{
      body='<div class="admin-dgr admin-dgr-hx admin-dgr-sent"><span>时间</span><span>平台</span><span>对象</span><span>类型</span><span>结果</span></div>'
        +shown.map(function(row){
          row=row||{};
          var target=String(row.target||'');
          return '<div class="admin-dgr admin-dgr-sent">'
            +'<span class="admin-dg-t">'+esc(adminHm(row.at))+'</span>'
            +'<span class="admin-e">'+esc(adminPlat(row.platform))+'</span>'
            +'<span class="admin-e" title="'+esc(target)+'">'+(target?esc(target):'<span class="admin-dash">—</span>')+'</span>'
            +'<span class="admin-e">'+esc(adminKind(row.kind))+'</span>'
            +'<span>'+adminOkBadge(row.ok)+'</span>'
            +'</div>';
        }).join('');
      if(list.length>shown.length)body+=adminDgMore('另有 '+(list.length-shown.length)+' 条未显示');
    }
    return adminDg('sent','当天发送',list.length+' 条',body);
  }

  function adminDgChats(list){
    var shown=list.length>adminChatMax?list.slice(list.length-adminChatMax):list;
    var body='';
    if(!shown.length)body=adminDgNone();
    else{
      body='<div class="admin-dgr admin-dgr-hx admin-dgr-chat"><span>时间</span><span>方向</span><span>对象</span><span>内容</span></div>'
        +shown.map(function(msg){
          msg=msg||{};
          var out=msg.direction==='out';
          var peer=String(msg.peerName||msg.peerId||'');
          var text=String(msg.text||'');
          var failed=out&&msg.status==='failed';
          return '<div class="admin-dgr admin-dgr-chat">'
            +'<span class="admin-dg-t">'+esc(adminHm(msg.at))+'</span>'
            +'<span><span class="badge'+(out?' warn':'')+'">'+(out?'发出':'收到')+'</span></span>'
            +'<span class="admin-e" title="'+esc(peer)+'">'+(peer?esc(peer):'<span class="admin-dash">—</span>')+'</span>'
            +'<span class="admin-e'+(failed?' admin-dayx-bad':'')+'" title="'+esc(text)+'">'+(text?esc(text):'<span class="admin-dash">—</span>')+'</span>'
            +'</div>';
        }).join('');
      if(list.length>shown.length)body+=adminDgMore('共 '+list.length+' 条，显示最近 '+shown.length+' 条');
    }
    return adminDg('chats','当天会话',list.length+' 条',body);
  }

  function adminDayBodyHtml(data){
    data=data||{};
    var jobs=Array.isArray(data.jobs)?data.jobs:[];
    var leads=Array.isArray(data.leads)?data.leads:[];
    var sent=Array.isArray(data.sent)?data.sent:[];
    var chats=Array.isArray(data.chats)?data.chats:[];
    return '<div class="admin-dgrid">'
      +adminDgJobs(jobs)+adminDgSent(sent)+adminDgLeads(leads)+adminDgChats(chats)
      +'</div>';
  }

  function adminDayNote(data){
    data=data||{};
    var totals=data.totals||{};
    var jobs=Array.isArray(data.jobs)?data.jobs.length:0;
    return '任务 '+jobs+' · 线索 '+(Number(totals.leads)||0)+' · 发送 '+(Number(totals.sent)||0)+' · 会话 '+(Number(totals.chats)||0);
  }

  function adminDayBodyFor(ref,entry){
    if(!entry||entry.state==='loading')return '<p class="loading admin-dayx-load">读取中…</p>';
    if(entry.state==='err'){
      return '<div class="admin-dayx-err"><b>当天明细没取到</b>'
        +'<span class="sub">'+esc(entry.err||'未知错误')+'</span>'
        +'<button class="btn sm" type="button" data-admin-dayr="'+esc(ref.key)+'">重试</button></div>';
    }
    return adminDayBodyHtml(entry.data);
  }

  function adminDayExpandHtml(ref){
    var entry=adminState.detail[ref.key];
    var note=!entry||entry.state==='loading'?'读取中…':(entry.state==='err'?'读取失败':adminDayNote(entry.data));
    return '<tr class="admin-day-x" id="adminDayX"><td colspan="8"><div class="admin-dayx">'
      +'<div class="admin-dayx-h"><b>'+esc(ref.date)+' · '+esc(ref.username)+'</b>'
      +'<span class="tiny admin-dayx-note">'+esc(note)+'</span><span class="spacer"></span>'
      +'<button class="btn sm ghost" type="button" data-admin-dayclose>收起</button></div>'
      +'<div class="admin-dayx-b">'+adminDayBodyFor(ref,entry)+'</div>'
      +'</div></td></tr>';
  }

  /** 按当前状态刷新：行按钮文案 + 展开区内容（同一时间只展开一行）。 */
  function adminDayPaint(ref){
    var open=adminDayIsOpen(ref);
    var tr=adminDayRowEl(ref.key);
    if(tr){
      var btn=tr.querySelector('.admin-day-btn');
      if(btn){
        btn.textContent=open?(adminState.detail[ref.key]&&adminState.detail[ref.key].state==='loading'?'读取中…':'收起'):'查看';
        btn.setAttribute('aria-expanded',open?'true':'false');
      }
      if(open)tr.classList.add('is-open');else tr.classList.remove('is-open');
    }
    if(!open)return;
    var x=adminDayXEl();
    if(!x)return;
    var entry=adminState.detail[ref.key];
    var note=x.querySelector('.admin-dayx-note');
    if(note)note.textContent=!entry||entry.state==='loading'?'读取中…':(entry.state==='err'?'读取失败':adminDayNote(entry.data));
    var body=x.querySelector('.admin-dayx-b');
    if(body)body.innerHTML=adminDayBodyFor(ref,entry);
  }

  function adminDayFetch(ref){
    var entry={state:'loading',data:null,err:''};
    adminState.detail[ref.key]=entry;
    adminDayPaint(ref);
    api('/api/admin/day?user='+encodeURIComponent(ref.username)+'&date='+encodeURIComponent(ref.date))
      .then(function(value){
        if(adminState.detail[ref.key]!==entry)return;
        entry.state='ok';entry.data=value||{};
        adminDayPaint(ref);
      },function(error){
        if(adminState.detail[ref.key]!==entry)return;
        entry.state='err';entry.err=adminErrText(error);
        adminDayPaint(ref);
      });
  }

  function adminDayOpen(ref){
    var prev=adminState.open;
    var old=adminDayXEl();
    if(old&&old.parentNode)old.parentNode.removeChild(old);
    if(prev&&prev.key!==ref.key){
      var prevRow=adminDayRowEl(prev.key);
      if(prevRow){
        prevRow.classList.remove('is-open');
        var prevBtn=prevRow.querySelector('.admin-day-btn');
        if(prevBtn){prevBtn.textContent='查看';prevBtn.setAttribute('aria-expanded','false')}
      }
    }
    adminState.open=ref;
    var tr=adminDayRowEl(ref.key);
    if(!tr)return;
    var holder=document.createElement('tbody');
    holder.innerHTML=adminDayExpandHtml(ref);
    var row=holder.firstElementChild;
    if(row)tr.parentNode.insertBefore(row,tr.nextSibling);
    var entry=adminState.detail[ref.key];
    if(entry&&(entry.state==='ok'||entry.state==='loading'))adminDayPaint(ref);
    else adminDayFetch(ref);
  }

  function adminDayClose(){
    var x=adminDayXEl();
    if(x&&x.parentNode)x.parentNode.removeChild(x);
    var ref=adminState.open;
    adminState.open=null;
    if(!ref)return;
    var tr=adminDayRowEl(ref.key);
    if(!tr)return;
    tr.classList.remove('is-open');
    var btn=tr.querySelector('.admin-day-btn');
    if(btn){btn.textContent='查看';btn.setAttribute('aria-expanded','false')}
  }

  function adminDayToggle(key){
    var ref=adminDaySplit(key);
    if(!ref)return;
    if(adminDayIsOpen(ref)){adminDayClose();return}
    adminDayOpen(ref);
  }

  function adminDayRetry(key){
    var ref=adminDaySplit(key);
    if(ref)adminDayFetch(ref);
  }

  function adminDayTableHtml(rows){
    var today=adminToday(),yesterday=adminYesterday();
    var body=rows.map(function(r){
      var mark=r.date===today?'<span class="admin-today">今天</span>'
        :r.date===yesterday?'<span class="admin-today">昨天</span>':'';
      var ref={key:adminDayKey(r.username,r.date),username:r.username,date:r.date};
      var open=adminDayIsOpen(ref);
      var entry=adminState.detail[ref.key];
      var label=open?(entry&&entry.state==='loading'?'读取中…':'收起'):'查看';
      var html='<tr class="admin-day-row'+(open?' is-open':'')+'" data-admin-day="'+esc(ref.key)+'">'
        +'<td data-label="日期"><span class="admin-date">'+esc(r.date)+mark+'</span></td>'
        +'<td data-label="用户">'+esc(r.username)+'</td>'
        +'<td data-label="关键词">'+adminKeywords(r.keywords)+'</td>'
        +'<td class="num" data-label="作品">'+adminNumCell(r.items)+'</td>'
        +'<td class="num" data-label="评论">'+adminNumCell(r.comments)+'</td>'
        +'<td class="num" data-label="群发">'+adminNumCell(r.sent)+'</td>'
        +'<td class="num" data-label="沟通客户">'+adminNumCell(r.customers)+'</td>'
        +'<td class="admin-day-op" data-label="当天明细"><button class="btn sm ghost admin-day-btn" type="button" aria-expanded="'+(open?'true':'false')+'">'+esc(label)+'</button></td>'
        +'</tr>';
      if(open)html+=adminDayExpandHtml(ref);
      return html;
    }).join('');
    return '<table class="tbl admin-tbl admin-tbl-day">'
      +'<colgroup><col class="admin-c1"><col class="admin-c2"><col class="admin-c3"><col class="admin-c4"><col class="admin-c5"><col class="admin-c6"><col class="admin-c7"><col class="admin-c8"></colgroup>'
      +'<thead><tr><th>日期</th><th>用户</th><th>关键词</th><th class="num">作品</th><th class="num">评论</th><th class="num">群发</th><th class="num">沟通客户</th><th class="admin-day-op">当天明细</th></tr></thead>'
      +'<tbody>'+body+'</tbody></table>';
  }

  function adminRenderDays(){
    var wrap=$('#adminDayWrap');if(!wrap)return;
    var sub=$('#adminDaysSub');
    if(adminState.activity===null){
      if(sub)sub.textContent=adminWindowText()+' · 按日期倒序，只列有记录的行。';
      wrap.innerHTML='<p class="hint admin-pad">按天明细没取到'+(adminState.activityErr?'：'+esc(adminState.activityErr):'')+'。点上面的「重试」再来一次。</p>';
      return;
    }
    var rows=adminDayRows();
    if(adminState.open){
      var still=false;
      for(var i=0;i<rows.length;i++){
        if(adminDayKey(rows[i].username,rows[i].date)===adminState.open.key){still=true;break}
      }
      if(!still)adminState.open=null;
    }
    if(sub)sub.textContent=adminWindowText()+' · '+(adminState.user||'全部用户')+' · 有记录 '+rows.length+' 行，点「查看」看当天任务、线索、发送与会话。';
    wrap.innerHTML=rows.length?adminDayTableHtml(rows):adminEmptyHtml();
  }

  /* ---------------------------------------------------------------- 渲染：账号概览 */
  function adminUsageTableHtml(rows){
    var body=rows.map(function(u){
      return '<tr>'
        +'<td data-label="用户">'+esc(u.username||'')+'</td>'
        +'<td data-label="状态">'+adminStatusBadge(u.status)+'</td>'
        +'<td data-label="角色">'+adminRoleBadge(u.role)+'</td>'
        +'<td class="num" data-label="累计作品">'+adminNumCell(u.items)+'</td>'
        +'<td class="num" data-label="评论">'+adminNumCell(u.comments)+'</td>'
        +'<td class="num" data-label="线索">'+adminNumCell(u.leads)+'</td>'
        +'<td class="num" data-label="已发私信">'+adminNumCell(u.sent)+'</td>'
        +'<td class="num" data-label="登录态">'+adminNumCell(u.logins)+'</td>'
        +'<td data-label="数据占用"><div class="admin-io"><b>'+esc(adminBytes(u.bytes))+'</b><div class="tiny">授权文件 '+esc(adminBytes(u.authBytes))+'</div></div></td>'
        +'<td data-label="最近活跃"><span class="admin-when">'+esc(adminTimeText(u.lastActive))+'</span></td>'
        +'</tr>';
    }).join('');
    return '<table class="tbl admin-tbl admin-tbl-use">'
      +'<colgroup><col class="admin-u1"><col class="admin-u2"><col class="admin-u3"><col class="admin-u4"><col class="admin-u5"><col class="admin-u6"><col class="admin-u7"><col class="admin-u8"><col class="admin-u9"><col class="admin-u10"></colgroup>'
      +'<thead><tr><th>用户</th><th>状态</th><th>角色</th><th class="num">累计作品</th><th class="num">评论</th><th class="num">线索</th><th class="num">已发私信</th><th class="num">登录态</th><th>数据占用</th><th>最近活跃</th></tr></thead>'
      +'<tbody>'+body+'</tbody></table>';
  }

  function adminUsageSumHtml(rows){
    var bytes=0,auth=0,pending=0;
    rows.forEach(function(u){
      bytes+=Number(u.bytes)||0;
      auth+=Number(u.authBytes)||0;
      if(String(u.status||'active')==='pending')pending++;
    });
    return '<span>共 <b>'+rows.length+'</b> 个账号</span>'
      +'<span>待审核 <b>'+pending+'</b> 个</span>'
      +'<span>总占用 <b>'+esc(adminBytes(bytes))+'</b></span>'
      +'<span>其中授权文件 <b>'+esc(adminBytes(auth))+'</b></span>';
  }

  function adminRenderUsage(){
    var wrap=$('#adminUsageWrap');if(!wrap)return;
    var sum=$('#adminUsageSum');
    if(adminState.usage===null){
      wrap.innerHTML='<p class="hint admin-pad">账号概览没取到'+(adminState.usageErr?'：'+esc(adminState.usageErr):'')+'。点「刷新」再来一次。</p>';
      if(sum)sum.innerHTML='';
      return;
    }
    var rows=adminUsageRows();
    if(!rows.length){
      wrap.innerHTML='<div class="empty"><b>还没有账号数据</b><p class="sub">新建用户或有人开始采集后，这里会显示每个账号的作品、线索、占用与最近活跃。</p></div>';
      if(sum)sum.innerHTML='';
      return;
    }
    wrap.innerHTML=adminUsageTableHtml(rows);
    if(sum)sum.innerHTML=adminUsageSumHtml(rows);
  }

  /* ---------------------------------------------------------------- 渲染：数据清理 */
  function adminCleanCount(v){var n=Number(v);return isFinite(n)&&n>0?n:0}

  /** 可清理条数倒序，同数按用户名。 */
  function adminCleanRows(){
    var rows=(adminClean.data&&Array.isArray(adminClean.data.users))?adminClean.data.users.slice():[];
    rows.sort(function(a,b){
      var ca=adminCleanCount(a&&a.candidates),cb=adminCleanCount(b&&b.candidates);
      if(ca!==cb)return cb-ca;
      return String((a&&a.username)||'').localeCompare(String((b&&b.username)||''),'zh-Hans');
    });
    return rows;
  }

  /** 汇总行自己按行重算，接口 totals 与明细不一致时也不自相矛盾。 */
  function adminCleanTotals(rows){
    var t={total:0,candidates:0,candidateBytes:0,skipped:0};
    rows.forEach(function(r){
      if(!r)return;
      t.total+=adminCleanCount(r.total);
      t.candidates+=adminCleanCount(r.candidates);
      t.candidateBytes+=adminCleanCount(r.candidateBytes);
      t.skipped+=adminCleanCount(r.skipped);
    });
    return t;
  }

  function adminCleanBytesCell(candidate,whole){
    var n=adminCleanCount(candidate);
    if(n<=0)return '<span class="admin-zero">0 KB</span>';
    return '<span title="评论正文共 '+esc(adminBytes(whole))+'">'+esc(adminBytes(n))+'</span>';
  }

  /** 顶部提示：有候选给 amber 警示，没有就一行绿字，未加载时整条隐藏。 */
  function adminCleanNotice(){
    var note=$('#adminCleanNote');if(!note)return;
    if(!adminClean.data){note.hidden=true;note.className='admin-clean-note';note.innerHTML='';return}
    var t=adminClean.data.totals||{};
    var cand=adminCleanCount(t.candidates);
    var days=adminCleanCount(adminClean.data.days)||adminClean.days;
    note.hidden=false;
    if(cand>0){
      note.className='admin-clean-note is-hit';
      note.innerHTML='<b>有 '+num(cand)+' 条评论</b><span>超过 '+days+' 天没有被筛选词命中，占用 '+esc(adminBytes(t.candidateBytes))+'，可清理；只删评论正文，线索与断点记录保留。</span>';
      return;
    }
    note.className='admin-clean-note is-clear';
    note.innerHTML='<span>暂时没有可清理的评论（超过 '+days+' 天的都还在保留范围内，或都被筛选词命中过）。</span>';
  }

  function adminCleanTableHtml(rows){
    var t=adminCleanTotals(rows);
    var body=rows.map(function(r){
      r=r||{};
      var cand=adminCleanCount(r.candidates);
      var terms=adminCleanCount(r.terms);
      return '<tr>'
        +'<td data-label="用户">'+esc(String(r.username||''))+'</td>'
        +'<td class="num" data-label="评论总数">'+adminNumCell(r.total)+'</td>'
        +'<td class="num" data-label="可清理条数">'+(cand>0?'<b>'+num(cand)+'</b>':'<span class="admin-zero">0</span>')+'</td>'
        +'<td class="num" data-label="可清理体积">'+adminCleanBytesCell(r.candidateBytes,r.bytes)+'</td>'
        +'<td class="num" data-label="无法判断时间">'+adminNumCell(r.skipped)+'</td>'
        +'<td class="num" data-label="筛选词数">'+(terms>0?num(terms):'<span class="admin-zero">0</span>')+'</td>'
        +'</tr>';
    }).join('');
    var foot='<tr>'
      +'<td colspan="2">合计 '+rows.length+' 个账号 · 评论 '+num(t.total)+' 条</td>'
      +'<td class="num"><b>'+num(t.candidates)+'</b> 条</td>'
      +'<td class="num"><b>'+esc(adminBytes(t.candidateBytes))+'</b></td>'
      +'<td class="num">'+num(t.skipped)+'</td>'
      +'<td class="num">—</td>'
      +'</tr>';
    return '<table class="tbl admin-tbl admin-clean-tbl">'
      +'<colgroup><col class="admin-q1"><col class="admin-q2"><col class="admin-q3"><col class="admin-q4"><col class="admin-q5"><col class="admin-q6"></colgroup>'
      +'<thead><tr><th>用户</th><th class="num">评论总数</th><th class="num">可清理条数</th><th class="num">可清理体积</th><th class="num">无法判断时间(跳过)</th><th class="num">筛选词数</th></tr></thead>'
      +'<tbody>'+body+'</tbody>'
      +'<tfoot>'+foot+'</tfoot></table>';
  }

  function adminCleanRender(){
    adminCleanNotice();
    var stamp=$('#adminCleanStamp');
    if(stamp)stamp.textContent=adminClean.stamp?('更新于 '+adminClean.stamp):'—';
    var wrap=$('#adminCleanWrap');if(!wrap)return;
    if(!adminClean.data){
      if(!adminClean.err){wrap.innerHTML='<p class="loading admin-pad">读取中…</p>';return}
      wrap.innerHTML='<p class="hint admin-pad">清理预览没取到：'+esc(adminClean.err)+'。点上面的「预览」再来一次。</p>';
      return;
    }
    var rows=adminCleanRows();
    if(!rows.length){
      wrap.innerHTML='<div class="empty"><b>还没有账号数据</b><p class="sub">有人开始采集评论后，这里会按账号列出可清理的条数、体积与筛选词数。</p></div>';
      return;
    }
    wrap.innerHTML=adminCleanTableHtml(rows);
  }

  /* ---------------------------------------------------------------- 数据清理：交互 */
  /** 二次确认：输入框内容必须正好是「确认清理」。 */
  function adminCleanConfirmHit(){
    var input=$('#adminCleanInput');
    return String(input?input.value:'').trim()==='确认清理';
  }

  function adminCleanMsgPaint(){
    var el=$('#adminCleanMsg');if(!el)return;
    el.className='admin-danger-msg'+(adminClean.msgKind?' is-'+adminClean.msgKind:'');
    el.textContent=adminClean.msg;
  }

  function adminCleanSyncBtns(){
    var pre=$('#adminCleanPreview'),run=$('#adminCleanRun'),ok=$('#adminCleanOk');
    var locked=!!(adminClean.busy||adminClean.run);
    if(pre)pre.disabled=locked;
    if(run){run.disabled=locked;run.textContent=adminClean.run?'清理中…':'执行清理'}
    if(ok)ok.disabled=locked||!adminCleanConfirmHit();
  }

  function adminCleanStageSet(stage){
    adminClean.stage=stage==='confirm'?'confirm':'idle';
    var box=$('#adminCleanConfirm');if(box)box.hidden=adminClean.stage!=='confirm';
    var input=$('#adminCleanInput');if(input)input.value='';
    adminCleanSyncBtns();
    if(adminClean.stage==='confirm'&&input)setTimeout(function(){try{input.focus()}catch(e){}},0);
  }

  async function adminCleanLoad(){
    if(adminClean.busy||adminClean.run)return;
    adminClean.busy=true;adminClean.err='';adminClean.data=null;
    var seq=++adminClean.seq;
    var note=$('#adminCleanNote');if(note){note.hidden=true;note.className='admin-clean-note';note.innerHTML=''}
    var wrap=$('#adminCleanWrap');if(wrap)wrap.innerHTML='<p class="loading admin-pad">读取中…</p>';
    var stamp=$('#adminCleanStamp');if(stamp)stamp.textContent='正在读取…';
    adminCleanSyncBtns();
    var out=null,err='';
    try{out=await api('/api/admin/cleanup?days='+encodeURIComponent(String(adminClean.days)))}
    catch(error){err=adminErrText(error)}
    adminClean.busy=false;
    if(seq!==adminClean.seq){adminCleanSyncBtns();return}
    if(err){adminClean.err=err;adminClean.stamp=''}
    else{
      adminClean.data=out||{days:adminClean.days,users:[],totals:{}};
      adminClean.stamp=adminClock();
    }
    adminCleanSyncBtns();
    adminCleanRender();
  }

  /** 只处理超期且从未被筛选词命中的评论正文，其余数据不动。 */
  async function adminCleanRunNow(){
    if(adminClean.run||adminClean.busy)return;
    if(!adminCleanConfirmHit())return;
    var days=adminClean.days;
    adminClean.run=true;
    adminClean.msg='清理中…';adminClean.msgKind='';
    adminCleanMsgPaint();
    adminCleanSyncBtns();
    var out=null,err='';
    try{out=await post('/api/admin/cleanup',{days:days,confirm:'确认清理'})}
    catch(error){err=adminErrText(error)}
    adminClean.run=false;
    adminCleanStageSet('idle');
    if(err){
      adminClean.msg='清理失败：'+err;adminClean.msgKind='bad';
      adminCleanMsgPaint();
      toast('清理失败','err');
      return;
    }
    var removed=adminCleanCount(out&&out.removed);
    var freed=adminCleanCount(out&&out.freedBytes);
    adminClean.msg='已删 '+num(removed)+' 条，释放 '+adminBytes(freed);
    adminClean.msgKind=removed>0?'ok':'';
    adminCleanMsgPaint();
    toast('已删 '+num(removed)+' 条，释放 '+adminBytes(freed),removed>0?'':'');
    if(typeof refreshAdminBadge==='function')refreshAdminBadge();
    adminCleanLoad();
  }

  function adminCleanBind(){
    var days=$('#adminCleanDays');
    if(days)days.onchange=function(){
      var v=Number(days.value);
      adminClean.days=v>0?v:adminCleanDefault;
      adminClean.stamp='';
      adminCleanStageSet('idle');
      adminCleanLoad();
    };
    var pre=$('#adminCleanPreview');
    if(pre)pre.onclick=function(){adminCleanLoad()};
    var run=$('#adminCleanRun');
    if(run)run.onclick=function(){
      if(adminClean.run||adminClean.busy)return;
      adminCleanStageSet(adminClean.stage==='confirm'?'idle':'confirm');
    };
    var input=$('#adminCleanInput');
    if(input){
      input.oninput=function(){adminCleanSyncBtns()};
      input.onkeydown=function(ev){
        var key=ev.key||'';
        if(key==='Enter'){ev.preventDefault();if(adminCleanConfirmHit())adminCleanRunNow();return}
        if(key==='Escape'){ev.preventDefault();adminCleanStageSet('idle')}
      };
    }
    var ok=$('#adminCleanOk');
    if(ok)ok.onclick=function(){adminCleanRunNow()};
    var cancel=$('#adminCleanCancel');
    if(cancel)cancel.onclick=function(){adminCleanStageSet('idle')};
    adminCleanSyncBtns();
    adminCleanMsgPaint();
  }

  /* ---------------------------------------------------------------- 共享内容库 */
  var adminLib={days:30,stage:'idle',busy:false,run:false,stats:null,plan:null,err:'',planErr:'',stamp:'',msg:'',msgKind:''};

  function adminLibHint(text,cls){
    var box=$('#adminLibStats');
    if(box)box.innerHTML='<p class="'+(cls||'hint')+' admin-pad">'+esc(text)+'</p>';
  }

  function adminLibCell(label,value,sub,zero){
    return '<div class="admin-cell'+(zero?' is-zero':'')+'"><span class="admin-cell-k">'+esc(label)+'</span>'+
      '<b class="admin-cell-n num">'+esc(String(value))+'</b><span class="admin-cell-s">'+esc(sub||'')+'</span></div>';
  }

  function adminLibRender(){
    var stamp=$('#adminGcStamp');
    if(stamp)stamp.textContent=adminLib.stamp?('更新于 '+adminLib.stamp):'—';
    var box=$('#adminLibStats');
    if(box){
      if(adminLib.err)adminLibHint('共享库没读到：'+adminLib.err);
      else if(!adminLib.stats)adminLibHint('读取中…','loading');
      else if(adminLib.stats.enabled===false)adminLibHint('共享库未启用（OMC_SHARED=0），当前按用户落盘。');
      else{
        var u=adminLib.stats.usage||{},r=adminLib.stats.reuse||{},k=r.byKind||{};
        var fetched=Number(r.fetched||0),reused=Number(r.reused||0);
        var ratio=(fetched+reused)>0?Math.round(reused*100/(fetched+reused)):0;
        var cells=adminLibCell('作品',num(u.items),'共享库唯一作品数',!u.items)
          +adminLibCell('评论',num(u.comments),'按评论 id 去重',!u.comments)
          +adminLibCell('媒体',num(u.blobs),adminBytes(u.blobBytes||0),!u.blobs)
          +adminLibCell('库体积',adminBytes((u.dbBytes||0)+(u.walBytes||0)),'含索引与 WAL',!u.dbBytes);
        var sums='<span>引用 <b>'+num(u.refs)+'</b> 条 · '+num(u.users)+' 个账号</span>'
          +'<span>近 30 天：抓取 <b>'+num(fetched)+'</b> 次 · 复用 <b>'+num(reused)+'</b> 次 · 复用率 <b>'+ratio+'%</b></span>'
          +(k.item?'<span>作品 抓 '+num(k.item.fetched)+' / 复 '+num(k.item.reused)+'</span>':'')
          +(k.comments?'<span>评论 抓 '+num(k.comments.fetched)+' / 复 '+num(k.comments.reused)+'</span>':'')
          +'<span class="tiny">'+esc(adminLib.stats.dir||'')+'</span>';
        box.innerHTML='<div class="admin-ledger">'+cells+'</div><div class="admin-sum">'+sums+'</div>';
      }
    }
    adminLibRenderPlan();
  }

  function adminLibRenderPlan(){
    var wrap=$('#adminGcWrap');if(!wrap)return;
    if(adminLib.planErr){wrap.innerHTML='<p class="hint admin-pad">回收预览没取到：'+esc(adminLib.planErr)+'。</p>';return}
    if(!adminLib.plan){wrap.innerHTML='<p class="hint admin-pad">点「预览回收」看没有引用、且超过保留期的作品。</p>';return}
    var p=adminLib.plan;
    var summary='<div class="admin-clean-note" role="status">可回收作品 '+num(p.items?p.items.length:0)+' 条 · 评论 '+num(p.comments)+' 条 · 媒体 '+num(p.blobs)+' 个（'+adminBytes(p.bytes||0)+'）</div>';
    if(!p.items||!p.items.length){
      wrap.innerHTML=summary+'<div class="empty"><b>没有可回收的内容</b><p class="sub">所有内容都还被至少一个账号引用，或还没超过保留期。</p></div>';
      return;
    }
    var rows=p.items.slice(0,50).map(function(it){
      return '<tr><td>'+esc(it.platform)+'</td><td class="mono">'+esc(it.id)+'</td></tr>';
    }).join('');
    wrap.innerHTML=summary
      +'<table class="tbl admin-tbl"><thead><tr><th>平台</th><th>作品 ID</th></tr></thead><tbody>'+rows+'</tbody></table>'
      +(p.items.length>50?'<p class="hint admin-pad">只列前 50 条，共 '+num(p.items.length)+' 条。</p>':'');
  }

  async function adminLibLoad(){
    if(adminLib.busy)return;
    adminLib.busy=true;adminLib.err='';
    adminLibHint('读取中…','loading');
    try{adminLib.stats=await api('/api/content/stats');adminLib.stamp=adminClock()}
    catch(error){adminLib.err=adminErrText(error);adminLib.stats=null}
    adminLib.busy=false;
    adminLibRender();
  }

  async function adminGcPreview(){
    if(adminLib.busy||adminLib.run)return;
    adminLib.busy=true;adminLib.planErr='';adminLib.plan=null;
    var wrap=$('#adminGcWrap');if(wrap)wrap.innerHTML='<p class="loading admin-pad">读取中…</p>';
    adminGcSync();
    try{adminLib.plan=await api('/api/content/gc?days='+encodeURIComponent(String(adminLib.days)));adminLib.stamp=adminClock()}
    catch(error){adminLib.planErr=adminErrText(error)}
    adminLib.busy=false;
    adminLibRender();
  }

  function adminGcConfirmHit(){
    var input=$('#adminGcInput');
    return String(input?input.value:'').trim()==='确认回收';
  }

  function adminGcMsgPaint(){
    var el=$('#adminGcMsg');if(!el)return;
    el.className='admin-danger-msg'+(adminLib.msgKind?' is-'+adminLib.msgKind:'');
    el.textContent=adminLib.msg;
  }

  function adminGcSync(){
    var pre=$('#adminGcPreview'),run=$('#adminGcRun'),ok=$('#adminGcOk');
    var locked=!!(adminLib.busy||adminLib.run);
    if(pre)pre.disabled=locked;
    if(run){run.disabled=locked;run.textContent=adminLib.run?'回收中…':'执行回收'}
    if(ok)ok.disabled=locked||!adminGcConfirmHit();
  }

  function adminGcStageSet(stage){
    adminLib.stage=stage==='confirm'?'confirm':'idle';
    var box=$('#adminGcConfirm');if(box)box.hidden=adminLib.stage!=='confirm';
    var input=$('#adminGcInput');if(input)input.value='';
    adminGcSync();
    if(adminLib.stage==='confirm'&&input)setTimeout(function(){try{input.focus()}catch(e){}},0);
  }

  async function adminGcApply(){
    if(adminLib.run||adminLib.busy)return;
    if(!adminGcConfirmHit())return;
    adminLib.run=true;adminLib.msg='回收中…';adminLib.msgKind='';
    adminGcMsgPaint();adminGcSync();
    var out=null,err='';
    try{out=await post('/api/content/gc',{days:adminLib.days,confirm:'确认回收'})}
    catch(error){err=adminErrText(error)}
    adminLib.run=false;
    adminGcStageSet('idle');
    if(err){
      adminLib.msg='回收失败：'+err;adminLib.msgKind='bad';
      adminGcMsgPaint();toast('回收失败','err');
      return;
    }
    adminLib.msg='已回收作品 '+num(out&&out.items?out.items.length:0)+' 条、评论 '+num(out&&out.comments)+' 条，释放 '+adminBytes((out&&out.bytes)||0);
    adminLib.msgKind=(out&&out.items&&out.items.length)?'ok':'';
    adminGcMsgPaint();
    toast('回收完成','ok');
    adminLib.plan=null;
    await adminLibLoad();
  }

  function adminGcBind(){
    var sel=$('#adminGcDays');
    if(sel)sel.onchange=function(){var v=Number(sel.value);adminLib.days=v>0?v:30;adminLib.plan=null;adminLib.planErr='';adminLibRenderPlan()};
    var pre=$('#adminGcPreview');
    if(pre)pre.onclick=function(){adminGcPreview()};
    var run=$('#adminGcRun');
    if(run)run.onclick=function(){if(adminLib.run||adminLib.busy)return;adminGcStageSet(adminLib.stage==='confirm'?'idle':'confirm')};
    var input=$('#adminGcInput');
    if(input){
      input.oninput=function(){adminGcSync()};
      input.onkeydown=function(ev){
        var key=ev.key||'';
        if(key==='Enter'){ev.preventDefault();if(adminGcConfirmHit())adminGcApply();return}
        if(key==='Escape'){ev.preventDefault();adminGcStageSet('idle')}
      };
    }
    var ok=$('#adminGcOk');
    if(ok)ok.onclick=function(){adminGcApply()};
    var cancel=$('#adminGcCancel');
    if(cancel)cancel.onclick=function(){adminGcStageSet('idle')};
    adminGcSync();adminGcMsgPaint();
  }

  /* ---------------------------------------------------------------- 错误横幅 */
  function adminShowErr(message){
    var box=$('#adminErr');if(!box)return;
    box.hidden=false;
    box.innerHTML='<b>用户管理没加载出来</b><p class="sub">'+esc(message)+'</p><button class="btn sm" type="button" data-admin-retry>重试</button>';
  }

  function adminClearErr(){
    var box=$('#adminErr');if(!box)return;
    box.hidden=true;box.innerHTML='';
  }

  function adminRender(){
    adminRenderLedger();
    adminRenderDays();
    adminRenderUsage();
    var stamp=$('#adminStamp');
    if(stamp)stamp.textContent=adminState.stamp?('更新于 '+adminState.stamp):'—';
  }

  /* ---------------------------------------------------------------- 用户下拉 */
  function adminSyncUsers(){
    var sel=$('#adminUser');if(!sel)return;
    var names=[];
    function add(name){
      var n=String(name||'');
      if(n&&names.indexOf(n)<0)names.push(n);
    }
    (Array.isArray(adminState.activity)?adminState.activity:[]).forEach(function(u){if(u)add(u.username)});
    if(!names.length)(Array.isArray(adminState.usage)?adminState.usage:[]).forEach(function(u){if(u)add(u.username)});
    names.sort(function(a,b){return a.localeCompare(b,'zh-Hans')});
    var html=['<option value="">全部用户'+(names.length?'（'+names.length+'）':'')+'</option>'];
    names.forEach(function(n){html.push('<option value="'+esc(n)+'">'+esc(n)+'</option>')});
    sel.innerHTML=html.join('');
    if(adminState.user&&names.indexOf(adminState.user)>=0)sel.value=adminState.user;
    else{sel.value='';adminState.user=''}
  }

  /* ---------------------------------------------------------------- 加载 */
  function adminLoading(){
    adminState.activityErr='';adminState.usageErr='';
    adminState.activity=null;adminState.usage=null;
    adminState.open=null;adminState.detail={};
    adminRenderLedger();
    var day=$('#adminDayWrap');if(day)day.innerHTML='<p class="loading admin-pad">读取中…</p>';
    var use=$('#adminUsageWrap');if(use)use.innerHTML='<p class="loading admin-pad">读取中…</p>';
    var sum=$('#adminUsageSum');if(sum)sum.innerHTML='';
    var stamp=$('#adminStamp');if(stamp)stamp.textContent='正在读取…';
    var sub=$('#adminDaysSub');if(sub)sub.textContent=adminWindowText()+' · 按日期倒序，只列有记录的行。';
    adminClearErr();
  }

  async function adminLoad(){
    if(adminState.busy)return;
    adminState.busy=true;
    var seq=++adminState.seq;
    adminLoading();
    var btn=$('#adminRefresh');if(btn)btn.disabled=true;
    var settle=function(p){
      return p.then(function(v){return {ok:true,value:v}},function(e){return {ok:false,error:e}});
    };
    var res=await Promise.all([
      settle(api('/api/admin/activity?days='+encodeURIComponent(String(adminState.days)))),
      settle(api('/api/admin/usage'))
    ]);
    adminState.busy=false;
    if(btn)btn.disabled=false;
    if(seq!==adminState.seq)return;
    var act=res[0],use=res[1];
    if(act.ok){
      adminState.activity=Array.isArray(act.value&&act.value.users)?act.value.users:[];
      adminState.activityErr='';
    }else{
      adminState.activity=null;
      adminState.activityErr=adminErrText(act.error);
    }
    if(use.ok){
      adminState.usage=Array.isArray(use.value&&use.value.users)?use.value.users:[];
      adminState.usageErr='';
    }else{
      adminState.usage=null;
      adminState.usageErr=adminErrText(use.error);
    }
    adminState.stamp=adminClock();
    adminSyncUsers();
    if(adminState.activityErr)adminShowErr(adminState.activityErr);
    else adminClearErr();
    adminRender();
  }

  /* ---------------------------------------------------------------- 交互 */
  function adminBind(){
    var days=$('#adminDays');
    if(days)days.onchange=function(){
      var v=Number(days.value);
      adminState.days=v>0?v:adminDaysDefault;
      adminState.stamp='';
      adminLoad();
    };
    var user=$('#adminUser');
    if(user)user.onchange=function(){
      adminState.user=String(user.value||'');
      adminRender();
    };
    var btn=$('#adminRefresh');
    if(btn)btn.onclick=function(){adminLoad()};
  }

  document.addEventListener('click',function(ev){
    var node=ev.target,hit=null;
    while(node&&node!==document){
      if(node.getAttribute&&(node.hasAttribute('data-admin-retry')||node.hasAttribute('data-admin-go')
        ||node.hasAttribute('data-admin-day')||node.hasAttribute('data-admin-dayr')||node.hasAttribute('data-admin-dayclose'))){hit=node;break}
      node=node.parentNode;
    }
    if(!hit)return;
    if(hit.hasAttribute('data-admin-retry')){adminLoad();return}
    if(hit.hasAttribute('data-admin-dayclose')){adminDayClose();return}
    if(hit.hasAttribute('data-admin-dayr')){adminDayRetry(hit.getAttribute('data-admin-dayr')||'');return}
    if(hit.hasAttribute('data-admin-day')){adminDayToggle(hit.getAttribute('data-admin-day')||'');return}
    if(hit.getAttribute('data-admin-go')==='crawl')omc.go('crawl');
  });

  adminBind();
  adminCleanBind();
  adminGcBind();

/* ---------------------------------------------------------------- 群发参数 */
async function adminSendLoad(){
  try{
    var s=await api('/api/settings');
    $('#adminSendCap').value=s.dailyCap;
    $('#adminSendBatch').value=s.batchMax;
    $('#adminSendMin').value=s.minSeconds;
    $('#adminSendMax').value=s.maxSeconds;
  }catch(e){
    var msg=$('#adminSendMsg');if(msg)msg.textContent='读取失败：'+e.message;
  }
}
var adminSendForm=$('#adminSendForm');
if(adminSendForm)adminSendForm.addEventListener('submit',async function(ev){
  ev.preventDefault();
  var cap=Number($('#adminSendCap').value),batch=Number($('#adminSendBatch').value),min=Number($('#adminSendMin').value),max=Number($('#adminSendMax').value);
  if(![cap,batch,min,max].every(function(n){return isFinite(n)&&n>0})){$('#adminSendMsg').textContent='四个数字都要填';return}
  var btn=$('#adminSendSave');btn.disabled=true;$('#adminSendMsg').textContent='保存中…';
  try{
    var s=await post('/api/settings',{dailyCap:cap,batchMax:batch,minSeconds:min,maxSeconds:max});
    $('#adminSendCap').value=s.dailyCap;$('#adminSendBatch').value=s.batchMax;$('#adminSendMin').value=s.minSeconds;$('#adminSendMax').value=s.maxSeconds;
    $('#adminSendMsg').textContent='已保存：单日 '+s.dailyCap+' 条，一次最多 '+s.batchMax+' 条，间隔 '+s.minSeconds+'-'+s.maxSeconds+' 秒';
    toast('群发参数已更新');
  }catch(e){$('#adminSendMsg').textContent='保存失败：'+e.message}
  finally{btn.disabled=false}
});

  omc.onShow('admin',adminLoad);
  omc.onShow('admin',adminSendLoad);
  omc.onShow('admin',adminCleanLoad);
  omc.onShow('admin',adminLibLoad);
})();
`,
}
