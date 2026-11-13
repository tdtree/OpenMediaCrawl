import type { View } from '../types.js'

/** 概览：4 个指标 + 近 14 天趋势 + 平台占比 + 运行状态。 */
export const overview: View = {
  id: 'overview',
  nav: '概览',
  title: '概览',
  sub: '线索总量、今日新增和任务状态。',
  css: String.raw`
/* ---- view: overview ---- */
.ov-err{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap;border-color:var(--danger);margin-bottom:var(--s3)}
.ov-err b{color:var(--danger)}
.ov-err .sub{flex:1 1 220px;min-width:0}

.ov-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:var(--s4)}
.ov-kpi{display:flex;flex-direction:column;gap:2px;min-width:0;padding:14px 16px;border-left:1px solid var(--line)}.ov-kpi:first-child{border-left:0;padding-left:0}
.ov-kpi-label{font-size:var(--fs-xs);color:var(--muted)}
.ov-kpi-num{font-size:30px;line-height:1.1;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.ov-kpi-sub{font-size:var(--fs-xs);color:var(--muted);line-height:1.35}
.ov-kpi.is-today .ov-kpi-num{color:var(--acc-ink)}
.ov-kpi.is-zero .ov-kpi-num{color:var(--muted)}

.ov-split{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:var(--s3);align-items:start}
.ov-side{display:flex;flex-direction:column;gap:var(--s3);min-width:0}

.ov-plot{position:relative;height:176px;margin-top:var(--s2)}
.ov-guides{position:absolute;inset:0;pointer-events:none}
.ov-guides i{position:absolute;left:0;right:0;height:0;border-top:1px dashed var(--line);opacity:.75}
.ov-bars{position:absolute;inset:0;display:flex;gap:var(--s1);border-bottom:1px solid var(--line)}
.ov-col{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end}
.ov-bar{display:block;width:100%;min-height:3px;background:var(--acc);opacity:.55;border-radius:0}
.ov-col:hover .ov-bar{opacity:.8}
.ov-col.is-today .ov-bar{opacity:1}
.ov-col.is-zero .ov-bar{display:none}
.ov-ticks{display:flex;gap:var(--s1);margin-top:6px}
.ov-tick{flex:1 1 0;min-width:0;text-align:center;font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.ov-tick.is-today{color:var(--acc-ink);font-weight:600}

.ov-sh{display:flex;flex-direction:column;gap:6px}
.ov-sh+.ov-sh{margin-top:var(--s3)}
.ov-sh-head{display:flex;align-items:baseline;gap:6px;font-size:var(--fs-sm);min-width:0}
.ov-sh-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-sh-code{font-size:var(--fs-xs);color:var(--muted);font-family:ui-monospace,Consolas,monospace}
.ov-sh-val{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.ov-sh-count{margin-left:6px;font-weight:400;font-size:var(--fs-xs);color:var(--muted)}
.ov-sh-track{height:6px;border-radius:999px;background:var(--row-hover);overflow:hidden}
.ov-sh-track i{display:block;height:100%;border-radius:999px;background:var(--acc);opacity:.85}

.ov-st{display:flex;flex-direction:column;gap:var(--s2)}
.ov-st-row{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s2);font-size:var(--fs-sm);padding-bottom:6px;border-bottom:1px dashed var(--line)}
.ov-st-row:last-child{border-bottom:0;padding-bottom:0}
.ov-st-row>span{color:var(--muted)}
.ov-st-row>b{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}

.ov-jobs{display:flex;flex-direction:column;gap:6px;margin-top:var(--s3)}
.ov-job{display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);min-width:0}
.ov-job-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

@media(max-width:1100px){.ov-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){.ov-split{grid-template-columns:minmax(0,1fr)}}
@media(max-width:720px){.ov-plot{height:140px}.ov-tick{font-size:11px}}
`,
  html: String.raw`<section class="sec">
  <div class="card ov-err" id="ovErr" hidden></div>
  <div class="ov-kpis">
    <div class="ov-kpi">
      <span class="ov-kpi-label">累计线索</span>
      <b class="ov-kpi-num num" id="ovTotal">—</b>
      <span class="ov-kpi-sub">线索库里一共攒了多少条</span>
    </div>
    <div class="ov-kpi is-today">
      <span class="ov-kpi-label">今日新增</span>
      <b class="ov-kpi-num num" id="ovToday">—</b>
      <span class="ov-kpi-sub">今天 0 点之后采到的</span>
    </div>
    <div class="ov-kpi">
      <span class="ov-kpi-label">联系方式命中</span>
      <b class="ov-kpi-num num" id="ovHits">—</b>
      <span class="ov-kpi-sub">带手机号或微信号的线索</span>
    </div>
    <div class="ov-kpi">
      <span class="ov-kpi-label">运行中任务</span>
      <b class="ov-kpi-num num" id="ovRunning">—</b>
      <span class="ov-kpi-sub">正在跑的采集任务</span>
    </div>
  </div>
</section>
<section class="sec">
  <div class="ov-split">
    <div class="card">
      <div class="sec-head"><h2>近 14 天新增线索</h2><span class="sub" id="ovTrendSub"></span></div>
      <div id="ovTrend"><p class="loading">读取中…</p></div>
    </div>
    <div class="ov-side">
      <div class="card">
        <div class="sec-head"><h2>平台占比</h2><span class="sub">按线索条数</span></div>
        <div id="ovShare"><p class="loading">读取中…</p></div>
      </div>
      <div class="card">
        <div class="sec-head"><h2>运行状态</h2></div>
        <div id="ovState"><p class="loading">读取中…</p></div>
      </div>
    </div>
  </div>
</section>`,
  js: String.raw`
/* ---- view: overview ---- */
var OV_PLATFORM_NAMES={xhs:'小红书',douyin:'抖音',tiktok:'TikTok',bilibili:'B 站',kuaishou:'快手',weibo:'微博',xianyu:'闲鱼',taobao:'淘宝',jd:'京东',x:'X','12306':'12306 铁路',jimeng:'即梦'};
var OV_JOB_TYPES={search:'关键词搜索',detail:'指定作品',creator:'指定博主'};

function overviewPlatform(id){
  var key=String(id==null?'':id);
  if(!key)return '未知平台';
  return OV_PLATFORM_NAMES[key]||key;
}

function overviewSetKpi(sel,value){
  var el=$(sel);if(!el)return;
  var n=Number(value);if(!isFinite(n))n=0;
  el.textContent=num(n);
  var cell=el.parentNode;
  if(cell&&cell.classList)cell.classList.toggle('is-zero',n<=0);
}

function overviewTrend(list){
  var box=$('#ovTrend');
  var rows=Array.isArray(list)?list:[];
  var max=0,sum=0;
  rows.forEach(function(t){var c=Number(t&&t.count)||0;if(c>max)max=c;sum+=c});
  if(!rows.length){
    box.innerHTML='<p class="hint">没有趋势数据。</p>';
    $('#ovTrendSub').textContent='';
    return;
  }
  var last=rows.length-1;
  var bars=rows.map(function(t,i){
    var count=Number(t&&t.count)||0;
    var height=count<=0?3:Math.max(6,Math.round(count/max*100));
    var cls='ov-col'+(i===last?' is-today':'')+(count<=0?' is-zero':'');
    var date=t&&t.date?String(t.date):'';
    var tip=(date||'未知日期')+' · '+count+' 条';
    return '<div class="'+cls+'" title="'+esc(tip)+'"><b class="ov-bar" style="height:'+height+(count<=0?'px':'%')+'"></b></div>';
  }).join('');
  var ticks=rows.map(function(t,i){
    var date=t&&t.date?String(t.date):'';
    var show=(last-i)%3===0;
    var label=date.length>=10?date.slice(5):date;
    var text=show?esc(label):'';
    return '<span class="ov-tick'+(i===last?' is-today':'')+'">'+text+'</span>';
  }).join('');
  box.innerHTML='<div class="ov-plot" role="img" aria-label="'+esc('近 14 天新增线索柱状图：合计 '+sum+' 条，单日最多 '+max+' 条')+'">'
    +'<div class="ov-guides"><i style="top:0"></i><i style="top:25%"></i><i style="top:50%"></i><i style="top:75%"></i></div>'
    +'<div class="ov-bars">'+bars+'</div></div>'
    +'<div class="ov-ticks">'+ticks+'</div>'
    +(sum<=0?'<p class="hint">近 14 天还没有新增线索。</p>':'');
  $('#ovTrendSub').textContent='合计 '+num(sum)+' 条 · 单日最多 '+num(max)+' 条 · 纵轴按峰值自适应';
}

function overviewShare(list){
  var box=$('#ovShare');
  var rows=Array.isArray(list)?list:[];
  if(!rows.length){
    box.innerHTML='<p class="hint">还没有线索，平台占比生成后会出现在这里。</p>';
    return;
  }
  box.innerHTML=rows.map(function(p){
    var raw=Number(p&&p.percent);
    var pct=isFinite(raw)?raw:0;
    var width=Math.max(0,Math.min(100,pct));
    var count=p&&typeof p.count==='number'?p.count:null;
    return '<div class="ov-sh">'
      +'<div class="ov-sh-head"><span class="ov-sh-name">'+esc(overviewPlatform(p&&p.platform))+'</span>'
      +'<span class="ov-sh-code">'+esc(p&&p.platform?String(p.platform):'')+'</span>'
      +'<span class="ov-sh-val num">'+pct+'%'+(count==null?'':'<span class="ov-sh-count num">'+num(count)+' 条</span>')+'</span></div>'
      +'<div class="ov-sh-track"><i style="width:'+width+'%"></i></div></div>';
  }).join('');
}

function overviewJobText(job){
  var o=(job&&job.options)||{};
  if(typeof o==='string'){try{o=JSON.parse(o)}catch(e){o={}}}
  var bits=[overviewPlatform(o.platform)];
  if(o.type)bits.push(OV_JOB_TYPES[o.type]||String(o.type));
  var kw=String(o.keywords||o.ids||o.creators||'');
  if(kw)bits.push(kw.length>16?kw.slice(0,16)+'…':kw);
  return bits.join(' · ');
}

function overviewState(d,jobs,jobsOk){
  var settings=(d&&d.settings)||{};
  var running=Number(d&&d.runningTasks)||0;
  var cap=typeof settings.dailyCap==='number'?settings.dailyCap:null;
  var min=typeof settings.minSeconds==='number'?settings.minSeconds:null;
  var max=typeof settings.maxSeconds==='number'?settings.maxSeconds:null;
  var body='<div class="ov-st">'
    +'<div class="ov-st-row"><span>运行中任务</span><b class="num">'+running+' 个</b></div>'
    +'<div class="ov-st-row"><span>单日私信上限</span><b class="num">'+(cap==null?'-':cap+' 条')+'</b></div>'
    +'<div class="ov-st-row"><span>发送间隔</span><b class="num">'+(min==null||max==null?'-':min+'–'+max+' 秒')+'</b></div>'
    +'</div>';
  var runningJobs=(Array.isArray(jobs)?jobs:[]).filter(function(j){return j&&j.status==='running'});
  if(!jobsOk){
    body+='<p class="hint">任务列表没取到，只显示汇总数字。</p>';
  }else if(runningJobs.length){
    body+='<div class="ov-jobs">'+runningJobs.slice(0,3).map(function(j){
      var text=overviewJobText(j);
      return '<div class="ov-job" title="'+esc(text)+'"><span class="badge run">运行中</span><span class="ov-job-t">'+esc(text)+'</span></div>';
    }).join('')+(runningJobs.length>3?'<p class="tiny">另有 '+(runningJobs.length-3)+' 个任务在跑</p>':'')+'</div>';
  }else{
    body+='<p class="hint">当前没有运行中的任务。</p>';
  }
  body+='<div class="row" style="margin-top:var(--s3)"><button class="btn sm ghost" data-ov-go="account">调整发送参数</button></div>';
  $('#ovState').innerHTML=body;
}

function overviewRender(d,jobs,jobsOk){
  var data=d||{};
  var total=Number(data.total)||0;
  overviewSetKpi('#ovTotal',total);
  overviewSetKpi('#ovToday',data.today);
  overviewSetKpi('#ovHits',data.contactHits);
  overviewSetKpi('#ovRunning',data.runningTasks);
  if(total<=0){
    $('#ovTrendSub').textContent='';
    $('#ovTrend').innerHTML='<div class="empty"><b>还没有线索</b><p class="sub">去「采集」跑一次关键词或作品采集，回来这里就能看到近 14 天的新增走势。</p><button class="btn" data-ov-go="crawl">去采集</button></div>';
    $('#ovShare').innerHTML='<div class="empty"><b>暂无平台数据</b><p class="sub">线索入库后按平台统计条数。</p></div>';
  }else{
    overviewTrend(data.trend);
    overviewShare(data.platformShare);
  }
  overviewState(data,jobs,jobsOk);
}

function overviewFail(err){
  var message=err&&err.message?String(err.message):String(err||'未知错误');
  var box=$('#ovErr');
  if(box){
    box.hidden=false;
    box.innerHTML='<b>概览没加载出来</b><p class="sub">'+esc(message)+'</p><button class="btn sm" data-ov-retry>重试</button>';
  }
  ['#ovTotal','#ovToday','#ovHits','#ovRunning'].forEach(function(sel){
    var el=$(sel);if(!el)return;
    el.textContent='—';
    if(el.parentNode&&el.parentNode.classList)el.parentNode.classList.add('is-zero');
  });
  $('#ovTrend').innerHTML='<p class="hint">数据没取到，点「重试」或右上角「刷新」再来一次。</p>';
  $('#ovShare').innerHTML='<p class="hint">—</p>';
  $('#ovState').innerHTML='<p class="hint">—</p>';
  var sub=$('#ovTrendSub');if(sub)sub.textContent='';
}

async function overviewLoad(){
  var err=$('#ovErr');
  if(err){err.hidden=true;err.textContent=''}
  var trend=$('#ovTrend'),share=$('#ovShare'),state=$('#ovState');
  if(trend)trend.innerHTML='<p class="loading">读取中…</p>';
  if(share)share.innerHTML='<p class="loading">读取中…</p>';
  if(state)state.innerHTML='<p class="loading">读取中…</p>';
  var data=null;
  try{data=await api('/api/dashboard')}
  catch(e){overviewFail(e);return}
  var jobs=[],jobsOk=true;
  try{
    var list=await api('/api/jobs');
    jobs=Array.isArray(list)?list:[];
  }catch(e){jobsOk=false}
  try{overviewRender(data,jobs,jobsOk)}
  catch(e){overviewFail(e)}
}

function overviewClick(ev){
  var node=ev.target,hit=null;
  while(node&&node!==document){
    if(node.getAttribute&&(node.getAttribute('data-ov-go')||node.hasAttribute('data-ov-retry'))){hit=node;break}
    node=node.parentNode;
  }
  if(!hit)return;
  if(hit.hasAttribute('data-ov-retry')){overviewLoad();return}
  var to=hit.getAttribute('data-ov-go');
  if(to==='crawl')omc.go('crawl');
  else if(to)omc.go(to);
}
document.addEventListener('click',overviewClick);

omc.onShow('overview',overviewLoad);
`,
}

