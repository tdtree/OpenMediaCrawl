import type { View } from '../types.js'

/**
 * 用户管理（仅 admin）：每个账号每天的关键词、评论、群发、沟通与占用。
 *
 * 结构：工具栏（天数 / 用户 / 刷新 / 更新时间）→ 台账式 4 汇总 → 按天明细 → 账号概览。
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

@media(max-width:1100px){
  .admin-tbl-day{min-width:0}
  .admin-tbl-use{min-width:820px}
}
@media(max-width:960px){
  .admin-ledger{grid-template-columns:repeat(2,minmax(0,1fr))}
  .admin-cell:nth-child(3){border-left:0;padding-left:0}
  .admin-cell:nth-child(n+3){border-top:1px solid var(--line)}
  .admin-tbl-wrap.admin-scroll{max-height:none}
}
@media(max-width:640px){
  .admin-f-days,.admin-f-user{width:100%}
  .admin-tbl{min-width:0;table-layout:auto}
  .admin-tbl col{width:auto}
  .admin-cell-n{font-size:24px}
  .admin-cell{padding:10px var(--s3) 11px}
  .admin-kw{max-width:none}
  .admin-tbl-wrap{border-color:transparent}
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
</section>`,
  js: String.raw`
/* ---- view: admin ---- */
(function(){
  var adminDaysDefault=14;
  var adminState={days:adminDaysDefault,user:'',busy:false,seq:0,activity:null,usage:null,activityErr:'',usageErr:'',stamp:''};

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

  function adminDayTableHtml(rows){
    var today=adminToday(),yesterday=adminYesterday();
    var body=rows.map(function(r){
      var mark=r.date===today?'<span class="admin-today">今天</span>'
        :r.date===yesterday?'<span class="admin-today">昨天</span>':'';
      return '<tr>'
        +'<td data-label="日期"><span class="admin-date">'+esc(r.date)+mark+'</span></td>'
        +'<td data-label="用户">'+esc(r.username)+'</td>'
        +'<td data-label="关键词">'+adminKeywords(r.keywords)+'</td>'
        +'<td class="num" data-label="作品">'+adminNumCell(r.items)+'</td>'
        +'<td class="num" data-label="评论">'+adminNumCell(r.comments)+'</td>'
        +'<td class="num" data-label="群发">'+adminNumCell(r.sent)+'</td>'
        +'<td class="num" data-label="沟通客户">'+adminNumCell(r.customers)+'</td>'
        +'</tr>';
    }).join('');
    return '<table class="tbl admin-tbl admin-tbl-day">'
      +'<colgroup><col class="admin-c1"><col class="admin-c2"><col class="admin-c3"><col class="admin-c4"><col class="admin-c5"><col class="admin-c6"><col class="admin-c7"></colgroup>'
      +'<thead><tr><th>日期</th><th>用户</th><th>关键词</th><th class="num">作品</th><th class="num">评论</th><th class="num">群发</th><th class="num">沟通客户</th></tr></thead>'
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
    if(sub)sub.textContent=adminWindowText()+' · '+(adminState.user||'全部用户')+' · 有记录 '+rows.length+' 行，日期倒序。';
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
      if(node.getAttribute&&(node.hasAttribute('data-admin-retry')||node.getAttribute('data-admin-go'))){hit=node;break}
      node=node.parentNode;
    }
    if(!hit)return;
    if(hit.hasAttribute('data-admin-retry')){adminLoad();return}
    if(hit.getAttribute('data-admin-go')==='crawl')omc.go('crawl');
  });

  adminBind();
  omc.onShow('admin',adminLoad);
})();
`,
}
