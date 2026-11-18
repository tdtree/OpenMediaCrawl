import type { View } from '../types.js'

/**
 * 采集：上面启动采集（基础 / 范围 / 高级 三组），下面回看已采数据（作品列表 → 详情 + 评论树）。
 * JS 与其它视图共享一个全局作用域，所有命名统一加 crawl 前缀。
 */
export const crawl: View = {
  id: 'crawl',
  nav: '采集',
  title: '采集',
  sub: '按关键词、作品或博主批量采集，回看已落盘的作品和评论。',
  css: String.raw`
/* ---------------------------------------------------------------- 采集：启动表单 */
/* 紧凑：输入框矮一点、间距小一点，一屏能看全基础+范围 */
.crawl-form{padding:var(--s3) var(--s4)}
.crawl-form .grid2,.crawl-form .grid3{gap:var(--s2)}
.crawl-form .field{gap:0}
.crawl-form .field>span{font-size:var(--fs-xs);line-height:1.7}
.crawl-form input,.crawl-form select{min-height:30px;padding:3px 8px;font-size:var(--fs-sm)}
.crawl-form .crawl-group+.crawl-group{margin-top:var(--s3);padding-top:var(--s3)}
.crawl-basic{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2) var(--s3)}
.crawl-basic #crawlFieldIds,.crawl-basic #crawlFieldCreators,.crawl-basic .crawl-chip-field{grid-column:1/-1}
.crawl-chip-n{margin:0 0 0 2px}
.crawl-sub{display:flex;align-items:center;gap:var(--s3)}
.crawl-sub .crawl-hint{flex:1;margin:0;min-width:0}
@media(max-width:1100px){.crawl-basic{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.crawl-basic{grid-template-columns:1fr}}
.crawl-form .crawl-gt{margin-bottom:var(--s1)}
.crawl-form .crawl-sub{margin-top:var(--s3)}
#crawlMax,#crawlMaxComments,#crawlSleep{max-width:150px}
.crawl-chips{min-height:32px}
.crawl-form .crawl-group+.crawl-group{margin-top:var(--s4);padding-top:var(--s4);border-top:1px dashed var(--line)}
.crawl-gt{font-size:var(--fs-xs);color:var(--muted);letter-spacing:.06em;margin-bottom:var(--s2)}
.crawl-adv{margin-top:var(--s4);padding-top:var(--s3);border-top:1px dashed var(--line)}
.crawl-adv>summary{font-size:var(--fs-sm);color:var(--muted);cursor:pointer;width:max-content}
.crawl-adv>summary:hover{color:var(--fg)}
.crawl-adv[open]>summary{margin-bottom:var(--s3)}
.crawl-adv-body{align-items:start}
.crawl-adv-body .crawl-wide{grid-column:1/-1}
.crawl-checks{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);padding-top:var(--s3)}
.crawl-sub{display:flex;align-items:center;gap:var(--s3);margin-top:var(--s3)}
.crawl-sub .primary{width:140px;flex:none}
.crawl-msg{font-size:var(--fs-xs);color:var(--muted);margin-top:var(--s2);min-height:1.2em}
.crawl-msg.err{color:var(--danger)}
.crawl-msg.ok{color:var(--ok)}

/* ---------------------------------------------------------------- 采集：词块编辑器（关键词 / 评论筛选共用） */
.crawl-chip-field{grid-column:1/-1}
.crawl-chip-head{display:flex;align-items:center;justify-content:space-between;gap:var(--s2);flex-wrap:wrap;min-height:24px}
.crawl-chip-head>span:first-child{color:var(--muted);font-size:var(--fs-sm)}
.crawl-chip-field.req .crawl-chip-label::after{content:" *";color:var(--danger)}
.crawl-chip-acts{display:flex;gap:var(--s1);margin-left:auto}
.crawl-chips{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s1);padding:3px 6px;border:1px solid var(--line);border-radius:4px;background:var(--card);min-height:38px;cursor:text}
.crawl-chips:focus-within{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc-soft)}
.crawl-chip{display:inline-flex;align-items:center;gap:2px;max-width:220px;padding:1px 3px 1px 7px;border-radius:3px;background:var(--acc-soft);color:var(--acc-ink);font-size:var(--fs-xs);line-height:1.7}
.crawl-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.crawl-chip-x{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:var(--fs-sm);min-height:0;padding:0 3px;line-height:1;opacity:.6;cursor:pointer}
button.crawl-chip-x:hover{opacity:1;background:transparent;color:var(--danger)}
input.crawl-chip-in{flex:1 1 120px;width:auto;min-width:80px;min-height:0;padding:3px 2px;border:0;background:transparent;font-size:var(--fs-sm)}
input.crawl-chip-in:focus{outline:none}
mark.crawl-hl{background:var(--acc-soft);color:var(--acc-ink);padding:0 2px;border-radius:2px}

/* ---------------------------------------------------------------- 采集：已采数据 master-detail */
.crawl-tools{display:flex;align-items:flex-end;gap:var(--s2);margin-left:auto}
.crawl-tools .field{min-width:150px}
.crawl-md{display:grid;grid-template-columns:320px minmax(0,1fr);gap:var(--s3);align-items:start}
.crawl-list{padding:0;max-height:min(72vh,760px);overflow:auto;overscroll-behavior:contain}
.crawl-list .loading,.crawl-list .empty{margin:0}
.crawl-it{display:block;width:100%;min-height:0;padding:var(--s2) var(--s3);border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.crawl-it:last-child{border-bottom:0}
.crawl-it:hover{background:var(--row-hover)}
.crawl-it[aria-current=true]{background:var(--acc-soft);color:var(--acc-ink)}
.crawl-it-t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:var(--fs-sm);line-height:1.4;word-break:break-word}
.crawl-it-m{display:flex;flex-wrap:wrap;gap:0 var(--s2);margin-top:2px;font-size:var(--fs-xs);color:var(--muted)}
.crawl-it[aria-current=true] .crawl-it-m{color:var(--acc-ink);opacity:.85}
.crawl-detail{min-height:320px;max-height:min(72vh,760px);overflow:auto;overscroll-behavior:contain}
/* 列表为空时只留一块空态，别让右侧再重复一遍「没有作品」 */
.crawl-md:has(#crawlList>.empty){grid-template-columns:minmax(0,1fr)}
.crawl-md:has(#crawlList>.empty) #crawlDetail{display:none}
.crawl-md:has(#crawlList>.empty) #crawlList{max-height:none}
.crawl-dt-head{display:flex;gap:var(--s3);align-items:flex-start}
.crawl-dt-t{min-width:0}
.crawl-dt-t h3{font-size:var(--fs-lg);line-height:1.35;word-break:break-word}
.crawl-cover{width:76px;height:76px;flex:none;object-fit:cover;border-radius:6px;border:1px solid var(--line);background:var(--row-hover)}
.crawl-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2);margin:var(--s3) 0}
.crawl-kv>div{border:1px solid var(--line);border-radius:8px;padding:var(--s2) var(--s3)}
.crawl-kv span{display:block;font-size:var(--fs-xs);color:var(--muted)}
.crawl-kv b{font-size:var(--fs-lg);font-weight:600;font-variant-numeric:tabular-nums}
.crawl-new{color:var(--ok);font-weight:600}
.crawl-media{display:flex;flex-wrap:wrap;gap:var(--s2);align-items:center;margin:0 0 var(--s3)}
.crawl-dt-c{border-top:1px solid var(--line);padding-top:var(--s3)}
.crawl-dt-ch{display:flex;align-items:baseline;gap:var(--s2);margin-bottom:var(--s2)}
.crawl-cm{border:1px solid var(--line);border-radius:8px;padding:var(--s2) var(--s3);margin-bottom:var(--s2);content-visibility:auto;contain-intrinsic-size:auto 88px}
.crawl-cm:last-child{margin-bottom:0}
.crawl-cm-h{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
.crawl-cm-pick{flex:none;cursor:pointer}
.crawl-cm-h b{font-size:var(--fs-sm);font-weight:600}
.crawl-cm-t{font-size:var(--fs-sm);margin:2px 0 var(--s2);white-space:pre-wrap;word-break:break-word}
.crawl-cm-a{display:flex;gap:var(--s2);flex-wrap:wrap}
.crawl-cm-kids{margin-top:var(--s2);padding-left:var(--s3);border-left:2px solid var(--line)}
.crawl-cm-kids .crawl-cm{border-style:dashed}
.crawl-cm.picked{border-color:var(--acc);background:var(--acc-soft)}
.crawl-cm-bar{display:flex;align-items:flex-end;gap:var(--s2);flex-wrap:wrap;margin-bottom:var(--s2)}
.crawl-cm-bar .crawl-cm-q{flex:1 1 320px;min-width:200px}
.crawl-cm-bar .crawl-cm-hit{flex:none;white-space:nowrap;padding-bottom:2px}
.crawl-cm-tools{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;margin-bottom:var(--s3);padding:var(--s2) var(--s3);border:1px solid var(--line);border-radius:8px;background:var(--row-hover)}
.crawl-cm-tools .crawl-cm-picked{margin-right:auto}
.crawl-empty-a{display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s3)}

@media(max-width:960px){
  .crawl-md{grid-template-columns:1fr}
  .crawl-list{max-height:300px}
  .crawl-detail{max-height:none;min-height:0}
  .crawl-kv{grid-template-columns:repeat(2,minmax(0,1fr))}
  .crawl-tools{margin-left:0;width:100%}
}
`,
  html: `
<section class="sec">
  <div class="sec-head">
    <h2>启动采集</h2>
    <span class="sub">任务在后台跑，日志和任务状态在「触达」页。</span>
  </div>
  <form class="card crawl-form" id="crawlForm" novalidate>
    <div class="crawl-group">
      <div class="crawl-gt">基础</div>
      <div class="crawl-basic">
        <label class="field req"><span>平台</span><select id="crawlPlatform" name="platform"></select></label>
        <label class="field req"><span>类型</span>
          <select id="crawlType" name="type">
            <option value="search">关键词搜索</option>
            <option value="detail">指定作品</option>
            <option value="creator">指定博主</option>
          </select>
        </label>
        <label class="field"><span>最多条数</span><input id="crawlMax" name="maxItems" type="number" min="1" step="1" value="20"></label>
        <label class="field"><span>排序</span><input id="crawlSort" name="sort" autocomplete="off" placeholder="如 latest，可留空…"></label>
        <label class="field req" id="crawlFieldIds" hidden><span>作品 ID / 链接</span><input id="crawlIds" name="ids" autocomplete="off" placeholder="逗号分隔，可整条粘贴…"></label>
        <label class="field req" id="crawlFieldCreators" hidden><span>博主 ID / 链接</span><input id="crawlCreators" name="creators" placeholder="逗号分隔，可粘主页链接…"></label>
        <div class="field req crawl-chip-field" id="crawlFieldKeywords">
          <div class="crawl-chip-head">
            <span><span class="crawl-chip-label">关键词</span> <span class="tiny crawl-chip-n" id="crawlKwN">共 0 个词</span></span>
            <span class="crawl-chip-acts">
              <button class="ghost sm" type="button" id="crawlKwImport">从词库导入</button>
              <button class="ghost sm" type="button" id="crawlKwClear">清空</button>
            </span>
          </div>
          <div class="crawl-chips" id="crawlKwChips" data-crawl-chips="kw">
            <input id="crawlKeywordsInput" class="crawl-chip-in" autocomplete="off" placeholder="空格 / 逗号 / 回车切词，或点右上导入…">
          </div>
          <input type="hidden" id="crawlKeywords" name="keywords" value="">
        </div>
      </div>
    </div>
    <details class="crawl-adv" id="crawlAdv">
      <summary>高级选项：保存格式、间隔、评论上限与媒体</summary>
      <div class="grid3 crawl-adv-body">
        <label class="field"><span>保存格式</span>
          <select id="crawlSave" name="save">
            <option value="jsonl">jsonl</option>
            <option value="json">json</option>
            <option value="csv">csv</option>
            <option value="sqlite">sqlite</option>
          </select>
        </label>
        <label class="field"><span>间隔秒数</span><input id="crawlSleep" name="sleep" value="2-5" autocomplete="off" placeholder="2-5 或 3…"></label>
        <label class="field"><span>每视频评论上限</span><input id="crawlMaxComments" name="maxComments" type="number" min="0" step="1" value="0" autocomplete="off" placeholder="0（不限，默认）…"></label>
        <div class="field crawl-wide"><span>附加</span>
          <div class="crawl-checks">
            <label class="check"><input type="checkbox" id="crawlOptComments" checked> 评论</label>
            <label class="check"><input type="checkbox" id="crawlOptSub"> 二级评论</label>
            <label class="check"><input type="checkbox" id="crawlOptMedia"> 下载图片/视频</label>
          </div>
        </div>
      </div>
      <p class="hint">二级评论默认不勾（勾选后请求更多、更慢）；勾它会自动带上「评论」。间隔写 2-5 表示每条之间随机 2~5 秒。</p>
      <p class="hint">每视频评论上限填 0 表示把该作品下所有一级评论都拉完（含自动翻页）；二级评论仍按需拉取。</p>
    </details>
    <div class="crawl-sub">
      <span class="hint crawl-hint">中断后重跑同一条命令：跑完的关键词整段跳过，没跑完的从上次翻页的位置继续。</span>
      <button class="primary" id="crawlStart" type="submit">开始采集</button>
    </div>
    <p class="crawl-msg" id="crawlFormMsg" role="status" aria-live="polite"></p>
  </form>
</section>

<section class="sec">
  <div class="sec-head">
    <h2>已采数据</h2>
    <span class="sub">左边挑作品，右边看详情和一级 / 二级评论。</span>
    <div class="crawl-tools">
      <label class="field"><span>平台</span><select id="crawlRecPlatform"></select></label>
      <button class="ghost sm" id="crawlRecRefresh" type="button">刷新列表</button>
    </div>
  </div>
  <div class="crawl-md">
    <div class="card crawl-list" id="crawlList"><p class="loading">读取已采作品…</p></div>
    <div class="card crawl-detail" id="crawlDetail">
      <div class="empty"><b>还没选作品</b><span class="sub">在左边列表点一条作品，这里显示标题、统计和评论。</span></div>
    </div>
  </div>
  <p class="crawl-msg" id="crawlRecMsg" role="status" aria-live="polite"></p>
</section>
`,
  js: String.raw`
/* ---------------------------------------------------------------- 采集页（crawl） */
var crawlFallback=[
  {id:'xhs',name:'小红书'},
  {id:'douyin',name:'抖音'},
  {id:'kuaishou',name:'快手'},
  {id:'bilibili',name:'B站'},
  {id:'weibo',name:'微博'},
  {id:'tiktok',name:'TikTok'},
  {id:'x',name:'X'}
];
var crawlState={ready:false,platforms:crawlFallback.slice(),recPlatform:'',items:[],sel:'',prefetch:null,comments:[],kw:[],filters:[],picked:{},noComments:false};
var crawlReqId=0;
var crawlIme=false;

function crawlMsg(el,text,kind){
  if(!el)return;
  el.textContent=text||'';
  el.className='crawl-msg'+(kind?' '+kind:'');
}

function crawlHasPlatform(id){
  if(!id)return false;
  return crawlState.platforms.some(function(p){return p.id===id});
}

function crawlFillSelects(main,rec){
  var html=crawlState.platforms.map(function(p){
    return '<option value="'+esc(p.id)+'">'+esc(p.name||p.id)+'</option>';
  }).join('');
  var a=$('#crawlPlatform'),b=$('#crawlRecPlatform');
  if(a){
    a.innerHTML=html;
    if(crawlHasPlatform(main))a.value=main;
  }
  if(b){
    b.innerHTML=html;
    if(crawlHasPlatform(rec))b.value=rec;
  }
}

/* 平台默认选「有落盘数据」的那个；探测失败或全空就退回第一个。 */
async function crawlDefaultPlatform(){
  var list=crawlState.platforms.slice();
  if(!list.length)return '';
  var probes=await Promise.all(list.map(function(p){
    return api('/api/records?platform='+encodeURIComponent(p.id)).then(function(r){
      return {platform:p.id,items:(r&&r.items)||[]};
    }).catch(function(){return null});
  }));
  var hit=null;
  probes.forEach(function(p){if(!hit&&p&&p.items.length)hit=p});
  if(hit){
    crawlState.prefetch=hit;
    return hit.platform;
  }
  return '';
}

async function crawlLoadPlatforms(){
  if(crawlState.ready)return;
  /* 只有已经选过平台才保留（recPlatform 为空＝第一次进页面，按落盘数据探测） */
  var cur=crawlState.recPlatform||'';
  var list=null;
  try{list=await api('/api/platforms')}catch(e){list=null}
  var seen={},items=[];
  if(Object.prototype.toString.call(list)==='[object Array]'){
    list.forEach(function(p){
      var id=String((p&&p.id)||'').trim();
      if(!id||seen[id])return;
      seen[id]=1;
      items.push({id:id,name:String((p&&p.name)||id)});
    });
  }else{
    crawlMsg($('#crawlFormMsg'),'平台清单读取失败，先用内置列表；提交可能被服务端拒绝。','err');
  }
  crawlFallback.forEach(function(p){
    if(seen[p.id])return;
    seen[p.id]=1;
    items.push({id:p.id,name:p.name});
  });
  crawlState.platforms=items;
  crawlFillSelects(cur,cur);
  var def=crawlHasPlatform(cur)?cur:'';
  if(!def){
    var picked='';
    try{picked=await crawlDefaultPlatform()}catch(e){picked=''}
    def=picked||(crawlState.platforms.length?crawlState.platforms[0].id:'');
  }
  crawlFillSelects(def,def);
  crawlState.recPlatform=def;
  /* 清单没读到时不留缓存，下次进页面再试；读到了才不再请求。 */
  crawlState.ready=!!(list&&list.length);
}

/* ---------------------------------------------------------------- 词块编辑器（关键词 / 评论筛选共用） */
var crawlChipSep=/[\/,，、;；|\s]/;
var crawlChipSplit=/[\/,，、;；|\s]+/;

function crawlChipBox(kind){return $(kind==='kw'?'#crawlKwChips':'#crawlCmChips')}
function crawlChipInputEl(kind){return $(kind==='kw'?'#crawlKeywordsInput':'#crawlCmFilter')}
function crawlChipList(kind){return kind==='kw'?crawlState.kw:crawlState.filters}
function crawlChipKind(el){
  if(!el||!el.closest)return '';
  var box=el.closest('[data-crawl-chips]');
  return box?(box.getAttribute('data-crawl-chips')||''):'';
}

function crawlChipHtml(term,kind){
  var t=esc(term);
  return '<span class="crawl-chip" data-crawl-chip="1" title="'+t+'">'+
    '<span class="crawl-chip-t">'+t+'</span>'+
    '<button class="crawl-chip-x" type="button" data-crawl-chip-del="'+t+'" data-crawl-chip-kind="'+esc(kind)+'" aria-label="删除 '+t+'">×</button>'+
  '</span>';
}

/* 提交兼容：表单里仍带 name=keywords 的隐藏 input，值始终是 join(',')。 */
function crawlSyncKwHidden(){
  var el=$('#crawlKeywords');
  if(el)el.value=(crawlState.kw||[]).join(',');
}

function crawlChipRender(kind){
  var isKw=kind==='kw';
  var list=crawlChipList(kind)||[];
  var box=crawlChipBox(kind),input=crawlChipInputEl(kind);
  if(box){
    $$('[data-crawl-chip]',box).forEach(function(el){if(el.parentNode)el.parentNode.removeChild(el)});
    var html=list.map(function(term){return crawlChipHtml(term,kind)}).join('');
    if(html){
      if(input)input.insertAdjacentHTML('beforebegin',html);
      else box.insertAdjacentHTML('afterbegin',html);
    }
  }
  var count=$(isKw?'#crawlKwN':'#crawlCmFilterN');
  if(count)count.textContent='共 '+list.length+' 个词';
  var clearBtn=$(isKw?'#crawlKwClear':'#crawlCmClear');
  if(clearBtn)clearBtn.disabled=!list.length;
  if(isKw)crawlSyncKwHidden();
}

/* 追加词块：忽略大小写去重，单个词最多 40 字（和词库一致）。返回 {added,skipped}。 */
function crawlChipAddList(kind,terms){
  var list=crawlChipList(kind);
  var arr=Object.prototype.toString.call(terms)==='[object Array]'?terms:[];
  var seen={};
  list.forEach(function(t){seen[String(t).toLowerCase()]=1});
  var added=0,skipped=0;
  arr.forEach(function(raw){
    var v=String(raw==null?'':raw).trim().slice(0,40);
    if(!v){skipped++;return}
    var key=v.toLowerCase();
    if(seen[key]){skipped++;return}
    seen[key]=1;
    list.push(v);
    added++;
  });
  if(added){
    crawlChipRender(kind);
    if(kind!=='kw'){crawlReportTerms();crawlRenderComments();}
  }
  return {added:added,skipped:skipped};
}

function crawlChipAddTerms(kind,raw){
  var text=String(raw==null?'':raw).trim();
  if(!text)return {added:0,skipped:0};
  var parts=text.split(crawlChipSplit).filter(function(t){return !!t});
  return crawlChipAddList(kind,parts);
}

/* 输入框里出现分隔符就切词；最后一段可能还没打完，留在输入框里。 */
function crawlChipFlush(kind,input){
  if(!input)return;
  var value=String(input.value||'');
  if(!crawlChipSep.test(value))return;
  var parts=value.split(crawlChipSplit);
  var tail=parts.pop()||'';
  if(parts.length)crawlChipAddList(kind,parts);
  input.value=tail;
}

/* 回车：把输入框里剩下的整段也切成词块（拦掉表单默认提交）。 */
function crawlChipCommit(kind,input){
  if(!input)return;
  var value=String(input.value||'').trim();
  input.value='';
  if(value)crawlChipAddTerms(kind,value);
}

function crawlChipPop(kind){
  var list=crawlChipList(kind);
  if(!list||!list.length)return;
  list.pop();
  crawlChipRender(kind);
  if(kind!=='kw'){crawlReportTerms();crawlRenderComments();}
}

function crawlChipRemove(kind,term){
  var list=crawlChipList(kind);
  if(!list)return;
  var at=-1;
  for(var i=0;i<list.length;i++)if(list[i]===term){at=i;break}
  if(at<0)return;
  list.splice(at,1);
  crawlChipRender(kind);
  if(kind!=='kw'){crawlReportTerms();crawlRenderComments();}
}

/* 把用过的评论筛选词留给后端（数据清理时判断“有没有被筛到过”）。 */
var crawlTermTimer=null;
function crawlReportTerms(){
  clearTimeout(crawlTermTimer);
  crawlTermTimer=setTimeout(function(){
    var terms=(crawlState.filters||[]).slice(0,50);
    if(!terms.length)return;
    post('/api/filters/used',{terms:terms}).catch(function(){});
  },800);
}

function crawlChipClear(kind){
  var list=crawlChipList(kind);
  var input=crawlChipInputEl(kind);
  if(input)input.value='';
  if(list&&list.length)list.length=0;
  crawlChipRender(kind);
  if(kind!=='kw')crawlRenderComments();
}

/* 从词库导入：GET /api/lexicon，去重追加；词库为空只提示，不动现有词块。 */
async function crawlChipImport(kind,btn){
  if(btn)btn.disabled=true;
  try{
    var r=await api('/api/lexicon');
    var source=r?(kind==='kw'?r.keywords:r.filters):null;
    var list=Object.prototype.toString.call(source)==='[object Array]'?source:[];
    if(!list.length){
      toast('词库里还没有'+(kind==='kw'?'关键词':'筛选词'),'');
      return;
    }
    var res=crawlChipAddList(kind,list);
    if(!res.added){
      toast('词库里的 '+list.length+' 个词都已经在了','');
      return;
    }
    toast('从词库导入 '+res.added+' 个词'+(res.skipped?'，跳过 '+res.skipped+' 个重复':''),'ok');
  }catch(e){
    toast('词库读取失败：'+e.message,'err');
  }finally{
    if(btn)btn.disabled=false;
  }
}

/* ---------------------------------------------------------------- 已采数据 */
function crawlEmptyActions(extra){
  return '<div class="crawl-empty-a">'+
    '<button class="ghost sm" type="button" data-crawl-go="account">去登录</button>'+
    '<button class="ghost sm" type="button" data-crawl-go="form">去采集</button>'+
    (extra||'')+
  '</div>';
}

function crawlEmptyRecords(){
  return '<div class="empty"><b>这个平台还没有落盘数据</b>'+
    '<span class="sub">先在上面启动一次采集；采集要登录态，没登录先去账号页。</span>'+
    crawlEmptyActions('')+'</div>';
}

function crawlEmptyComments(){
  if(crawlState.noComments){
    return '<div class="empty"><b>该平台暂不支持评论采集</b>'+
      '<span class="sub">这个平台的 CLI 没有 comment list，作品能采，评论拿不到。</span>'+
      crawlEmptyActions('')+'</div>';
  }
  return '<div class="empty"><b>这条作品没采到评论</b>'+
    '<span class="sub">采集时勾上「评论」再跑一次，或换一条作品看。</span>'+
    crawlEmptyActions('')+'</div>';
}

function crawlItemHtml(it){
  var st=it.stats||{};
  return '<button type="button" class="crawl-it" data-crawl-item="'+esc(it.id)+'">'+
    '<span class="crawl-it-t">'+esc(it.title||'（无标题）')+'</span>'+
    '<span class="crawl-it-m"><span>'+esc(it.author||'未知作者')+'</span>'+
      '<span>赞 '+num(st.likes)+'</span>'+
      '<span>评 '+num(it.comments)+(it.new_comments?' <b class="crawl-new">+' + num(it.new_comments) + '</b>':'')+'</span></span>'+
  '</button>';
}

function crawlCurrentItem(){
  var items=crawlState.items||[];
  for(var i=0;i<items.length;i++)if(items[i].id===crawlState.sel)return items[i];
  return null;
}

function crawlRenderDetail(it){
  var box=$('#crawlDetail');
  if(!box)return;
  var st=it.stats||{};
  var cover=it.cover?'<img class="crawl-cover" src="'+esc(it.cover)+'" alt="" width="96" height="96" loading="lazy">':'';
  var line=[it.author||'未知作者',it.created_at?fmtTime(it.created_at):''].filter(Boolean).join(' · ');
  var cells=[['阅读',st.views],['点赞',st.likes],['评论',it.comments],['收藏',st.collects]].map(function(c){
    return '<div><span>'+c[0]+'</span><b>'+num(c[1])+'</b></div>';
  }).join('');
  box.innerHTML='<div class="crawl-dt-head">'+cover+
    '<div class="crawl-dt-t"><h3>'+esc(it.title||'（无标题）')+'</h3>'+
      '<p class="sub">'+esc(line)+'</p>'+
      (it.url?'<p class="tiny"><a href="'+esc(it.url)+'" target="_blank" rel="noopener">打开原页 ↗</a></p>':'<p class="tiny">没有原页链接</p>')+
      '<div class="row" style="margin-top:8px"><button class="ghost sm" id="crawlCheckNew" type="button" title="只拉第一页起的新评论，遇到已知评论就停">检查新评论</button></div>'+
    '</div></div>'+
    '<div class="crawl-kv">'+cells+'</div>'+
    '<div class="crawl-media" id="crawlMedia" hidden></div>'+
    '<div class="crawl-dt-c">'+
      '<div class="crawl-dt-ch"><h3>评论</h3><span class="badge" id="crawlCmCount">读取中…</span></div>'+
      '<div class="crawl-cm-bar" id="crawlCmBar" hidden>'+
        '<div class="field crawl-cm-q crawl-chip-field">'+
          '<div class="crawl-chip-head"><span>评论筛选 <span class="tiny crawl-chip-n" id="crawlCmFilterN">共 0 个词</span></span>'+
            '<span class="crawl-chip-acts">'+
              '<button class="ghost sm" id="crawlCmImport" type="button">从词库导入</button>'+
              '<button class="ghost sm" id="crawlCmClear" type="button">清空</button>'+
            '</span></div>'+
          '<div class="crawl-chips" id="crawlCmChips" data-crawl-chips="filter">'+
            '<input id="crawlCmFilter" class="crawl-chip-in" type="text" autocomplete="off" placeholder="空格或 / 切词，命中任一即显示…">'+
          '</div>'+
        '</div>'+
        '<span class="tiny crawl-cm-hit" id="crawlCmHit">命中 0 条 / 共 0 条</span>'+
      '</div>'+
      '<div class="crawl-cm-tools" id="crawlCmTools" hidden>'+
        '<label class="check"><input type="checkbox" id="crawlCmAll"> 全选可见</label>'+
        '<button class="ghost sm" id="crawlCmPickClear" type="button">清除</button>'+
        '<span class="tiny crawl-cm-picked" id="crawlCmPicked">已选 0 条</span>'+
        '<button class="sm" id="crawlCmBulkReply" type="button" data-crawl-bulk="reply" disabled>加入回复候选 (0)</button>'+
        '<button class="sm" id="crawlCmBulkDm" type="button" data-crawl-bulk="dm" disabled>加入私信候选 (0)</button>'+
      '</div>'+
      '<div id="crawlCommentList"><p class="loading">读取评论…</p></div>'+
    '</div>';
  /* 详情是整块重建的，筛选词块按当前状态补回来，免得词块区和筛选词脱节 */
  crawlChipRender('filter');
  var checkNew=$('#crawlCheckNew');
  if(checkNew)checkNew.onclick=function(){crawlCheckNewComments(it,checkNew)};
  crawlLoadMedia(it);
}

/** 单作品增量：只拉评论，遇到足够多已知评论就停；不下载媒体。 */
async function crawlCheckNewComments(it,btn){
  if(!it||!btn)return;
  var label=btn.textContent;
  btn.disabled=true;btn.textContent='检查中…';
  try{
    var r=await post('/api/records/check-comments',{platform:crawlState.recPlatform,item:it.id});
    var msg=r.added?('新增 '+r.added+' 条评论（翻了 '+r.pages+' 页）'):'没有新评论';
    toast(msg,r.added?'ok':'');
    it.comments=r.total;
    if(r.added)it.new_comments=(it.new_comments||0)+r.added;
    if(r.added){try{await post('/api/leads/sync',{})}catch(e){}}
    await crawlLoadRecords();
    var cur=crawlCurrentItem();
    if(cur&&cur.id===it.id)await crawlLoadComments(cur);
  }catch(e){
    toast('检查失败：'+e.message,'err');
  }finally{
    btn.disabled=false;btn.textContent=label;
  }
}

/* 媒体：只列清单，点开走 /api/media 读共享库的 blob（视频直接浏览器播放/下载）。 */
async function crawlLoadMedia(it){
  var box=$('#crawlMedia');
  if(!box||!it)return;
  box.hidden=true;box.innerHTML='';
  try{
    var r=await api('/api/media/list?platform='+encodeURIComponent(crawlState.recPlatform)+'&item='+encodeURIComponent(it.id));
    var list=(r&&r.media)||[];
    if(!list.length)return;
    var kindName={video:'视频',audio:'音频',image:'图片'};
    box.innerHTML='<span class="tiny">媒体 '+list.length+' 个</span>'+list.map(function(m){
      var label=(kindName[m.kind]||'媒体')+' '+(m.seq||'')+(m.bytes?' · '+crawlSize(m.bytes):'');
      if(!m.ready)return '<span class="badge" title="采集时没下载成功">'+esc(label)+' · 未下载</span>';
      var href='/api/media?platform='+encodeURIComponent(crawlState.recPlatform)+'&item='+encodeURIComponent(it.id)+'&seq='+encodeURIComponent(String(m.seq));
      return '<a class="btn sm ghost" href="'+esc(href)+'" target="_blank" rel="noopener">'+esc(label)+'</a>';
    }).join('');
    box.hidden=false;
  }catch(e){/* 媒体只是附加信息，读不到不影响作品和评论 */}
}

function crawlSize(bytes){
  var n=Number(bytes)||0;
  if(n>=1048576)return (n/1048576).toFixed(1)+' MB';
  if(n>=1024)return Math.round(n/1024)+' KB';
  return n+' B';
}

/* 高亮：先把正文当纯文本转义，再只为命中片段套 <mark>；关键词当字面量拼进正则（大小写不敏感），
   所以正文里的 < > & " 都不会被当成标签，词里的正则元字符也不会生效。 */
function crawlHl(text,tokens){
  var raw=String(text==null?'':text);
  if(!tokens||!tokens.length)return esc(raw);
  var seen={},list=[];
  tokens.forEach(function(t){
    var v=String(t==null?'':t).trim().slice(0,40);
    if(!v)return;
    var key=v.toLowerCase();
    if(seen[key])return;
    seen[key]=1;
    list.push(v);
  });
  if(!list.length)return esc(raw);
  list.sort(function(a,b){return b.length-a.length});
  var re=new RegExp('('+list.map(function(t){return t.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&')}).join('|')+')','gi');
  var out='',pos=0,hits=0,m;
  while((m=re.exec(raw))!==null&&hits<500){
    if(m[0]===''){re.lastIndex++;continue}
    out+=esc(raw.slice(pos,m.index))+'<mark class="crawl-hl">'+esc(m[0])+'</mark>';
    pos=m.index+m[0].length;
    hits++;
  }
  out+=esc(raw.slice(pos));
  return out;
}

function crawlCommentHtml(c,child,kids,tokens){
  var a=c.author||{};
  var who=a.name||a.id||'匿名';
  var uid=a.id||'';
  var list=kids||c.children||[];
  var sub=list.length
    ? '<div class="crawl-cm-kids">'+list.map(function(k){return crawlCommentHtml(k,true,null,tokens)}).join('')+'</div>'
    : '';
  return '<div class="crawl-cm'+(child?' child':'')+'" data-comment="'+esc(c.id)+'" data-user="'+esc(uid)+'" data-who="'+esc(who)+'">'+
    '<div class="crawl-cm-h">'+
      '<label class="check crawl-cm-pick"><input type="checkbox" data-crawl-pick="1" aria-label="勾选这条评论"></label>'+
      '<b>'+crawlHl(who,tokens)+'</b>'+
      (c.first_seen_at&&Date.now()-Number(c.first_seen_at)<7*86400000?'<span class="badge ok" title="最近 7 天新采到的评论">新</span>':'')+
      (c.created_at?'<span class="tiny">'+esc(fmtTime(c.created_at))+'</span>':'')+
      '<span class="tiny">赞 '+num(c.stats&&c.stats.likes)+'</span>'+
      (c.province?'<span class="badge">'+esc(c.province)+'</span>':'')+
    '</div>'+
    '<p class="crawl-cm-t">'+crawlHl(c.text||'',tokens)+'</p>'+
    '<div class="crawl-cm-a">'+
      '<button class="ghost sm" type="button" data-crawl-act="reply">回复</button>'+
      '<button class="ghost sm" type="button" data-crawl-act="cand-reply">加回复候选</button>'+
      (uid?'<button class="ghost sm" type="button" data-crawl-act="cand-dm">加私信候选</button>':'')+
    '</div>'+sub+'</div>';
}

async function crawlLoadComments(it){
  var box=$('#crawlCommentList');
  if(!box||!it)return;
  var token=++crawlReqId;
  crawlResetComments();
  crawlShowCmUi(false);
  var hitEl=$('#crawlCmHit');
  if(hitEl)hitEl.textContent='命中 0 条 / 共 0 条';
  box.innerHTML='<p class="loading">读取评论…</p>';
  try{
    var r=await api('/api/records/comments?platform='+encodeURIComponent(crawlState.recPlatform)+'&item='+encodeURIComponent(it.id));
    if(token!==crawlReqId)return;
    var roots=(r&&r.comments)||[];
    crawlState.comments=roots;
    var all=crawlCommentsAll();
    var badge=$('#crawlCmCount');
    if(badge)badge.textContent=roots.length?(roots.length+' 条一级 · 共 '+all+' 条'):'0 条';
    if(!roots.length){
      box.innerHTML=crawlEmptyComments();
      crawlShowCmUi(false);
      return;
    }
    crawlShowCmUi(true);
    crawlRenderComments();
  }catch(e){
    if(token!==crawlReqId)return;
    var badge2=$('#crawlCmCount');
    if(badge2)badge2.textContent='读取失败';
    crawlShowCmUi(false);
    box.innerHTML='<div class="empty"><b>评论读取失败</b><span class="sub">'+esc(e.message)+'</span>'+
      '<div class="crawl-empty-a"><button class="ghost sm" type="button" data-crawl-go="comments">重试</button>'+
      '<button class="ghost sm" type="button" data-crawl-go="account">去登录</button></div></div>';
  }
}

/* ---------------------------------------------------------------- 评论：关键词筛选 + 批量勾选 */
function crawlCommentsAll(){
  var roots=crawlState.comments||[],n=0;
  roots.forEach(function(c){n+=1+((c.children&&c.children.length)||0)});
  return n;
}

/* 词块即筛选词，全部小写；空数组＝不过滤。 */
function crawlFilterTokens(){
  var out=[];
  (crawlState.filters||[]).forEach(function(token){
    var v=String(token==null?'':token).trim().toLowerCase();
    if(v)out.push(v);
  });
  return out;
}

/* 匹配范围：评论正文 + 作者名，大小写不敏感。 */
function crawlCommentHit(c,tokens){
  if(!tokens.length)return true;
  var a=(c&&c.author)||{};
  var text=(String((c&&c.text)||'')+' '+String(a.name||'')).toLowerCase();
  for(var i=0;i<tokens.length;i++)if(text.indexOf(tokens[i])>=0)return true;
  return false;
}

function crawlShowCmUi(on){
  var bar=$('#crawlCmBar'),tools=$('#crawlCmTools');
  if(bar)bar.hidden=!on;
  if(tools)tools.hidden=!on;
}

function crawlResetComments(){
  crawlState.comments=[];
  /* 筛选词跨作品保留：切作品时只清选中态和输入框，不清词块 */
  crawlState.picked={};
  var input=$('#crawlCmFilter');
  if(input)input.value='';
  crawlChipRender('filter');
}

/* 一级评论：自己命中或任一二级命中就留下；自己命中时二级全留（看上下文），否则只留命中的二级。 */
function crawlRenderComments(){
  var box=$('#crawlCommentList');
  if(!box)return;
  var roots=crawlState.comments||[];
  var tokens=crawlFilterTokens();
  var words=crawlState.filters||[];
  var total=crawlCommentsAll();
  var html=[],shown=0;
  roots.forEach(function(c){
    var kids=(c.children||[]).slice();
    var self=crawlCommentHit(c,tokens);
    if(tokens.length&&!self)kids=kids.filter(function(k){return crawlCommentHit(k,tokens)});
    if(tokens.length&&!self&&!kids.length)return;
    html.push(crawlCommentHtml(c,false,kids,words));
    shown+=1+kids.length;
  });
  var hit=$('#crawlCmHit');
  if(hit)hit.textContent='命中 '+shown+' 条 / 共 '+total+' 条';
  crawlState.picked={};
  if(!html.length){
    box.innerHTML='<div class="empty"><b>没有评论命中「'+esc(words.join(' / '))+'」</b>'+
      '<span class="sub">只在评论正文和作者名里找；词块之间是「或」，命中任一即显示。</span>'+
      '<div class="crawl-empty-a"><button class="ghost sm" type="button" data-crawl-go="filter-clear">清空筛选</button></div></div>';
  }else{
    box.innerHTML=html.join('');
  }
  crawlSyncPicked();
}

function crawlSyncPicked(){
  var picked=crawlState.picked||{};
  var n=Object.keys(picked).length;
  var label=$('#crawlCmPicked');
  if(label)label.textContent='已选 '+n+' 条';
  var rb=$('#crawlCmBulkReply'),db=$('#crawlCmBulkDm');
  if(rb){rb.textContent='加入回复候选 ('+n+')';rb.disabled=!n}
  if(db){db.textContent='加入私信候选 ('+n+')';db.disabled=!n}
  var cards=$$('#crawlCommentList .crawl-cm');
  var on=0;
  cards.forEach(function(card){
    var id=card.getAttribute('data-comment')||'';
    var hit=!!picked[id];
    var box=card.querySelector('[data-crawl-pick]');
    if(box)box.checked=hit;
    if(hit){on++;card.className=card.className.replace(/\s*picked/g,'')+' picked'}
    else card.className=card.className.replace(/\s*picked/g,'');
  });
  var allBox=$('#crawlCmAll');
  if(allBox){
    allBox.disabled=!cards.length;
    allBox.checked=!!cards.length&&on===cards.length;
    allBox.indeterminate=on>0&&on<cards.length;
  }
}

function crawlPickToggle(input){
  var card=input.closest?input.closest('.crawl-cm'):null;
  if(!card)return;
  var id=card.getAttribute('data-comment')||'';
  if(!id)return;
  if(input.checked){
    crawlState.picked[id]={commentId:id,userId:card.getAttribute('data-user')||'',userName:card.getAttribute('data-who')||''};
  }else{
    delete crawlState.picked[id];
  }
  crawlSyncPicked();
}

/* 全选可见：只勾当前筛选后仍在页面上的评论（一级 + 二级）。 */
function crawlPickAll(checked){
  if(!checked){
    crawlState.picked={};
    crawlSyncPicked();
    return;
  }
  $$('#crawlCommentList .crawl-cm').forEach(function(card){
    var id=card.getAttribute('data-comment')||'';
    if(!id)return;
    crawlState.picked[id]={commentId:id,userId:card.getAttribute('data-user')||'',userName:card.getAttribute('data-who')||''};
  });
  crawlSyncPicked();
}

async function crawlBulkCandidates(btn,type){
  var item=crawlCurrentItem();
  var kind=type==='dm'?'dm':'reply';
  if(!item){
    toast('先在左边选一条作品','err');
    return;
  }
  var picked=crawlState.picked||{};
  var ids=Object.keys(picked);
  if(!ids.length){
    toast('先勾选要加的评论','err');
    return;
  }
  var note=String(item.title||'').slice(0,80);
  var rows=[],noId=0;
  ids.forEach(function(id){
    var row=picked[id];
    if(!row)return;
    if(kind==='dm'&&!row.userId){noId++;return}
    rows.push({commentId:row.commentId,userId:row.userId||undefined,userName:row.userName||undefined,note:note});
  });
  if(!rows.length){
    toast('勾选的评论都没有作者 ID，加不了私信候选','err');
    return;
  }
  var cut=rows.slice(0,500);
  if(btn)btn.disabled=true;
  try{
    var r=await post('/api/candidates/bulk',{type:kind,platform:crawlState.recPlatform,itemId:item.id,items:cut});
    var added=Number((r&&r.added)||0);
    var skipped=Number((r&&r.skipped)||0);
    var text='已加入 '+added+' 条'+(kind==='dm'?'私信':'回复')+'候选';
    if(skipped)text+='，'+skipped+' 条已在候选池';
    if(noId)text+='，跳过 '+noId+' 条（没有作者 ID）';
    if(rows.length>cut.length)text+='；一次最多 500 条，其余 '+(rows.length-cut.length)+' 条没提交';
    toast(text,added?'ok':'');
    crawlMsg($('#crawlRecMsg'),text,added?'ok':'');
    crawlState.picked={};
    try{omc.call('refreshCandidates')}catch(e){}
  }catch(e){
    toast('批量加入候选失败：'+e.message,'err');
    crawlMsg($('#crawlRecMsg'),'批量加入候选失败：'+e.message,'err');
  }finally{
    crawlSyncPicked();
    if(btn)btn.disabled=!Object.keys(crawlState.picked||{}).length;
  }
}

function crawlOnChange(ev){
  var t=ev.target;
  if(!t||!t.getAttribute)return;
  if(t.id==='crawlCmAll'){crawlPickAll(!!t.checked);return}
  if(t.getAttribute('data-crawl-pick')!==null)crawlPickToggle(t);
}

function crawlOnInput(ev){
  var t=ev.target;
  if(!t||!t.closest||t.tagName!=='INPUT')return;
  var kind=crawlChipKind(t);
  if(!kind)return;
  if(ev.isComposing||crawlIme)return;
  crawlChipFlush(kind,t);
}

function crawlOnKey(ev){
  var t=ev.target;
  if(!t||!t.closest||t.tagName!=='INPUT')return;
  var kind=crawlChipKind(t);
  if(!kind)return;
  if(ev.isComposing||crawlIme)return;
  if(ev.key==='Enter'){
    ev.preventDefault();
    crawlChipCommit(kind,t);
    return;
  }
  if(ev.key==='Backspace'&&!t.value){
    ev.preventDefault();
    crawlChipPop(kind);
    return;
  }
  if(ev.key==='Escape'&&kind!=='kw'){
    ev.preventDefault();
    crawlChipClear(kind);
  }
}

function crawlSelect(id){
  var items=crawlState.items||[];
  var it=null;
  for(var i=0;i<items.length;i++)if(items[i].id===id)it=items[i];
  if(!it)return;
  crawlState.sel=it.id;
  $$('#crawlList .crawl-it').forEach(function(b){
    if(b.getAttribute('data-crawl-item')===it.id)b.setAttribute('aria-current','true');
    else b.removeAttribute('aria-current');
  });
  crawlRenderDetail(it);
  crawlLoadComments(it);
}

async function crawlLoadRecords(){
  var box=$('#crawlList'),detail=$('#crawlDetail');
  var pick=$('#crawlRecPlatform');
  var platform=pick?pick.value:crawlState.recPlatform;
  if(!platform){
    if(box)box.innerHTML=crawlEmptyRecords();
    if(detail)detail.innerHTML='<div class="empty"><b>没有可采集的平台</b><span class="sub">平台清单没读到，先去账号页确认登录态。</span><div class="crawl-empty-a"><button class="ghost sm" type="button" data-crawl-go="account">去登录</button></div></div>';
    crawlMsg($('#crawlRecMsg'),'平台清单为空，先确认服务端正常。','err');
    return;
  }
  if(platform!==crawlState.recPlatform)crawlState.noComments=false;
  crawlState.recPlatform=platform;
  if(box)box.innerHTML='<p class="loading">读取已采作品…</p>';
  if(detail)detail.innerHTML='<p class="loading">读取中…</p>';
  crawlMsg($('#crawlRecMsg'),'');
  var cached=crawlState.prefetch;
  crawlState.prefetch=null;
  var r=null;
  try{
    r=(cached&&cached.platform===platform)?cached:await api('/api/records?platform='+encodeURIComponent(platform));
  }catch(e){
    if(box)box.innerHTML='<div class="empty"><b>作品读取失败</b><span class="sub">'+esc(e.message)+'</span>'+
      '<div class="crawl-empty-a"><button class="ghost sm" type="button" data-crawl-go="reload">重试</button>'+
      '<button class="ghost sm" type="button" data-crawl-go="account">去登录</button></div></div>';
    if(detail)detail.innerHTML='<div class="empty"><b>作品读取失败</b><span class="sub">'+esc(e.message)+'</span></div>';
    crawlMsg($('#crawlRecMsg'),'作品读取失败：'+e.message,'err');
    return;
  }
  var items=(r&&r.items)||[];
  crawlState.items=items;
  if(!items.length){
    crawlState.sel='';
    if(box)box.innerHTML=crawlEmptyRecords();
    if(detail)detail.innerHTML='<div class="empty"><b>没有可看的作品</b><span class="sub">这个平台还没有落盘数据，先启动一次采集。</span><div class="crawl-empty-a"><button class="ghost sm" type="button" data-crawl-go="form">去采集</button></div></div>';
    crawlMsg($('#crawlRecMsg'),'平台 '+platform+' 下暂无已采作品','');
    return;
  }
  if(box)box.innerHTML=items.map(crawlItemHtml).join('');
  var keep=items.some(function(it){return it.id===crawlState.sel})?crawlState.sel:items[0].id;
  crawlSelect(keep);
  crawlMsg($('#crawlRecMsg'),'共 '+items.length+' 条作品 · 点左侧切换','');
}

/* ---------------------------------------------------------------- 评论上的动作 */
function crawlScrollToForm(){
  var form=$('#crawlForm');
  if(form&&form.scrollIntoView)form.scrollIntoView({behavior:'smooth',block:'start'});
}

function crawlReply(item,commentId){
  var payload={platform:crawlState.recPlatform,itemId:item.id,commentId:commentId};
  var hooked=!!(omc.hooks&&typeof omc.hooks.replyTo==='function');
  try{omc.go('reach')}catch(e){}
  if(hooked){
    try{
      omc.call('replyTo',payload);
      toast('已带到触达页的互动表单');
    }catch(e){
      toast('互动表单填写失败：'+e.message,'err');
    }
  }else{
    toast('已跳到触达页；把评论 '+commentId+' 填进「回复评论」');
  }
}

async function crawlAddCandidate(btn,act,item,commentId,userId,userName){
  var type=act==='cand-dm'?'dm':'reply';
  if(type==='dm'&&!userId){
    toast('这条评论没有作者 ID，加不了私信候选','err');
    return;
  }
  btn.disabled=true;
  try{
    var r=await post('/api/candidates',{
      type:type,
      platform:crawlState.recPlatform,
      itemId:item.id,
      commentId:commentId,
      userId:userId||undefined,
      userName:userName||undefined,
      note:String(item.title||'').slice(0,80)
    });
    var added=!!(r&&r.added);
    toast(added?'已加入候选池':'已在候选池里',added?'ok':'');
    crawlMsg($('#crawlRecMsg'),added?'已加入候选池，去触达页统一发':'这条已在候选池里','ok');
    try{omc.call('refreshCandidates')}catch(e){}
  }catch(e){
    crawlMsg($('#crawlRecMsg'),'加入候选失败：'+e.message,'err');
    toast('加入候选失败：'+e.message,'err');
  }finally{
    btn.disabled=false;
  }
}

function crawlCommentAction(btn){
  var card=btn.closest?btn.closest('.crawl-cm'):null;
  if(!card)return;
  var act=btn.getAttribute('data-crawl-act');
  var commentId=card.getAttribute('data-comment')||'';
  var userId=card.getAttribute('data-user')||'';
  var userName=card.getAttribute('data-who')||'';
  var item=crawlCurrentItem();
  if(!item||!commentId)return;
  if(act==='reply')crawlReply(item,commentId);
  else crawlAddCandidate(btn,act,item,commentId,userId,userName);
}

function crawlOnClick(ev){
  var t=ev.target;
  if(!t||!t.closest)return;
  var goBtn=t.closest('[data-crawl-go]');
  if(goBtn){
    var what=goBtn.getAttribute('data-crawl-go');
    if(what==='account'){omc.go('account');return}
    if(what==='form'){crawlScrollToForm();return}
    if(what==='reload'){crawlLoadRecords();return}
    if(what==='filter-clear'){crawlChipClear('filter');return}
    if(what==='comments'){var cur=crawlCurrentItem();if(cur)crawlLoadComments(cur);return}
  }
  var bulkBtn=t.closest('[data-crawl-bulk]');
  if(bulkBtn){crawlBulkCandidates(bulkBtn,bulkBtn.getAttribute('data-crawl-bulk'));return}
  if(t.closest('#crawlCmPickClear')){crawlState.picked={};crawlSyncPicked();return}
  var chipDel=t.closest('[data-crawl-chip-del]');
  if(chipDel){
    crawlChipRemove(chipDel.getAttribute('data-crawl-chip-kind')||'',chipDel.getAttribute('data-crawl-chip-del')||'');
    return;
  }
  var kwImport=t.closest('#crawlKwImport');
  if(kwImport){crawlChipImport('kw',kwImport);return}
  var kwClear=t.closest('#crawlKwClear');
  if(kwClear){crawlChipClear('kw');return}
  var cmImport=t.closest('#crawlCmImport');
  if(cmImport){crawlChipImport('filter',cmImport);return}
  var cmClear=t.closest('#crawlCmClear');
  if(cmClear){crawlChipClear('filter');return}
  var chipsBox=t.closest('[data-crawl-chips]');
  if(chipsBox){
    var chipsInput=chipsBox.querySelector('input');
    if(chipsInput&&t!==chipsInput)chipsInput.focus();
    return;
  }
  var itemBtn=t.closest('[data-crawl-item]');
  if(itemBtn){crawlSelect(itemBtn.getAttribute('data-crawl-item'));return}
  var actBtn=t.closest('[data-crawl-act]');
  if(actBtn){crawlCommentAction(actBtn);return}
}

/* ---------------------------------------------------------------- 启动采集表单 */
function crawlSyncType(){
  var type=$('#crawlType')?$('#crawlType').value:'search';
  var map={search:'#crawlFieldKeywords',detail:'#crawlFieldIds',creator:'#crawlFieldCreators'};
  Object.keys(map).forEach(function(key){
    var el=$(map[key]);
    if(el)el.hidden=type!==key;
  });
}

async function crawlSubmit(ev){
  ev.preventDefault();
  var msg=$('#crawlFormMsg');
  var platformEl=$('#crawlPlatform'),typeEl=$('#crawlType');
  if(!platformEl||!typeEl)return;
  var platform=platformEl.value,type=typeEl.value;
  /* 输入框里还没回车的那段也算一个词：提交前先切成词块，再同步隐藏 input */
  var kwInput=$('#crawlKeywordsInput');
  if(kwInput&&String(kwInput.value||'').trim())crawlChipCommit('kw',kwInput);
  crawlSyncKwHidden();
  var kw=$('#crawlKeywords'),ids=$('#crawlIds'),cre=$('#crawlCreators');
  var values={
    keywords:kw?kw.value.trim():'',
    ids:ids?ids.value.trim():'',
    creators:cre?cre.value.trim():''
  };
  if(!platform){
    crawlMsg(msg,'先选一个平台','err');
    return;
  }
  var label=type==='search'?'关键词':(type==='detail'?'作品 ID / 链接':'博主 ID / 链接');
  var key=type==='search'?'keywords':(type==='detail'?'ids':'creators');
  if(!values[key]){
    crawlMsg(msg,'请填「'+label+'」，这个类型必填','err');
    var focus=$(type==='search'?'#crawlKeywordsInput':(type==='detail'?'#crawlIds':'#crawlCreators'));
    if(focus&&focus.focus)focus.focus();
    return;
  }
  var maxItems=Number($('#crawlMax')?$('#crawlMax').value:'');
  if(!isFinite(maxItems)||maxItems<1){
    crawlMsg(msg,'最多条数要填大于 0 的整数','err');
    return;
  }
  var capEl=$('#crawlMaxComments');
  var capRaw=capEl?String(capEl.value).trim():'';
  var maxComments=capRaw===''?0:Number(capRaw);
  if(!isFinite(maxComments)||maxComments<0){
    crawlMsg(msg,'每视频评论上限要填 0 或正整数（0 = 不限）','err');
    if(capEl&&capEl.focus)capEl.focus();
    return;
  }
  var payload={
    platform:platform,
    type:type,
    keywords:values.keywords,
    ids:values.ids,
    creators:values.creators,
    maxItems:Math.floor(maxItems),
    save:$('#crawlSave')?$('#crawlSave').value:'jsonl',
    sleep:($('#crawlSleep')&&$('#crawlSleep').value.trim())||'2-5',
    comments:!!($('#crawlOptComments')&&$('#crawlOptComments').checked),
    subComments:!!($('#crawlOptSub')&&$('#crawlOptSub').checked),
    maxComments:Math.floor(maxComments),
    media:!!($('#crawlOptMedia')&&$('#crawlOptMedia').checked)
  };
  var sort=$('#crawlSort')?$('#crawlSort').value.trim():'';
  if(sort)payload.sort=sort;
  var btn=$('#crawlStart');
  if(btn)btn.disabled=true;
  crawlMsg(msg,'正在提交采集任务…','');
  try{
    var r=await post('/api/jobs',payload);
    toast('任务已启动');
    crawlMsg(msg,'任务已启动'+(r&&r.id?'（'+String(r.id).slice(0,8)+'）':'')+'，正在等待平台返回…','ok');
    try{omc.call('refreshJobs')}catch(e){}
    if(r&&r.id)crawlWatchJob(r.id);
  }catch(e){
    crawlMsg(msg,'启动失败：'+e.message,'err');
    toast('启动失败：'+e.message,'err');
  }finally{
    if(btn)btn.disabled=false;
  }
}

/* 启动后盯这个任务：把最后一条进度显示在表单下面，结束就刷新「已采数据」。 */
async function crawlWatchJob(id){
  var msg=$('#crawlFormMsg');
  var deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline){
    await new Promise(function(done){setTimeout(done,2000)});
    var r=null;
    try{r=await api('/api/jobs/'+encodeURIComponent(id)+'/log')}catch(e){return}
    if(!r)return;
    var lines=(r.lines||[]).filter(function(line){return line.type!=='item'&&line.type!=='comment'});
    var last=lines.length?String(lines[lines.length-1].message||''):'';
    if(r.status==='running'){
      crawlMsg(msg,'任务运行中：'+(last||'等待平台返回…'),'');
      continue;
    }
    var label=r.status==='done'?'完成':(r.status==='stopped'?'已停止':'失败');
    if(r.commentsUnsupported)crawlState.noComments=true;
    var unsupported=r.status==='done'&&r.commentsUnsupported;
    crawlMsg(msg,'任务'+label+(unsupported?'：该平台暂不支持评论采集（作品已落盘）':(last?'：'+last:'')),r.status==='done'?'ok':'err');
    toast('任务'+label,r.status==='done'?'ok':'err');
    try{await crawlLoadRecords()}catch(e){}
    return;
  }
}

async function crawlOnShow(){
  try{
    await crawlLoadPlatforms();
  }catch(e){
    crawlMsg($('#crawlFormMsg'),'平台清单读取失败：'+e.message,'err');
  }
  try{
    await crawlLoadRecords();
  }catch(e){
    crawlMsg($('#crawlRecMsg'),'已采数据读取失败：'+e.message,'err');
  }
}

function crawlInit(){
  var form=$('#crawlForm');
  if(form)form.addEventListener('submit',crawlSubmit);
  var type=$('#crawlType');
  if(type)type.addEventListener('change',crawlSyncType);
  var sub=$('#crawlOptSub');
  if(sub)sub.addEventListener('change',function(){
    if(sub.checked&&$('#crawlOptComments'))$('#crawlOptComments').checked=true;
  });
  var refresh=$('#crawlRecRefresh');
  if(refresh)refresh.addEventListener('click',function(){crawlState.sel='';crawlLoadRecords()});
  var pick=$('#crawlRecPlatform');
  if(pick)pick.addEventListener('change',function(){crawlState.sel='';crawlLoadRecords()});
  document.addEventListener('click',crawlOnClick);
  document.addEventListener('change',crawlOnChange);
  document.addEventListener('input',crawlOnInput);
  document.addEventListener('keydown',crawlOnKey);
  /* 粘贴一长串词时整体切词，不留半截在输入框 */
  document.addEventListener('paste',function(ev){
    var t=ev.target;
    if(!t||!t.closest||t.tagName!=='INPUT')return;
    var kind=crawlChipKind(t);
    if(!kind)return;
    var dt=ev.clipboardData||window.clipboardData;
    var text=dt&&dt.getData?String(dt.getData('text')||''):'';
    if(!text||!crawlChipSep.test(text))return;
    ev.preventDefault();
    crawlChipAddTerms(kind,text);
  });
  /* 中文输入法拼写过程中的空格/回车不切词 */
  document.addEventListener('compositionstart',function(){crawlIme=true});
  document.addEventListener('compositionend',function(ev){
    crawlIme=false;
    var t=ev.target;
    if(!t||!t.closest||t.tagName!=='INPUT')return;
    var kind=crawlChipKind(t);
    if(kind)crawlChipFlush(kind,t);
  });
  crawlFillSelects('','');
  crawlSyncType();
  crawlChipRender('kw');
  omc.onShow('crawl',crawlOnShow);
}

crawlInit();
`,
}
