import type { View } from '../types.js'

/**
 * 线索：主任务是「看 / 筛 / 加候选池 / 导出」。
 * 首屏 = 一行自动同步状态 + 一行统计 + 一条工具栏 + 表格；进页面即自动同步，导出是唯一主按钮。
 * 视图 js 与其它视图共享全局作用域，id / class / 变量一律 leads 前缀。
 */
export const leads: View = {
  id: 'leads',
  nav: '线索',
  title: '线索',
  sub: '按平台、地域和联系方式筛选评论线索，加入私信候选池或导出 CSV。',
  css: String.raw`
.leads-stats{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s5);margin-bottom:var(--s3)}
.leads-stat{display:inline-flex;align-items:baseline;gap:6px}
.leads-stat b{font-size:var(--fs-xl);font-weight:600;line-height:1.1}
.leads-stat span{font-size:var(--fs-sm);color:var(--muted)}
.leads-stat-note{font-size:var(--fs-xs);color:var(--muted)}

.leads-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--s3);padding:var(--s3) var(--s4)}
.leads-bar .field{flex:0 0 auto}
.leads-f-platform{width:170px}
.leads-f-province{width:150px}
.leads-bar .leads-chip-field{flex:2 1 360px;min-width:260px}
.leads-chip-head{display:flex;align-items:center;gap:var(--s2);min-height:22px}
.leads-chip-head>span:first-child{color:var(--muted);font-size:var(--fs-sm)}
.leads-chip-n{white-space:nowrap}
.leads-chip-acts{display:flex;gap:var(--s1);margin-left:auto}
.leads-chips{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s1);padding:3px 6px;border:1px solid var(--line);border-radius:4px;background:var(--card);min-height:36px;cursor:text}
.leads-chips:focus-within{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc-soft)}
.leads-chip{display:inline-flex;align-items:center;gap:2px;max-width:220px;padding:1px 3px 1px 7px;border-radius:3px;background:var(--acc-soft);color:var(--acc-ink);font-size:var(--fs-xs);line-height:1.7}
.leads-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.leads-chip-x{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:var(--fs-sm);min-height:0;padding:0 3px;line-height:1;opacity:.6;cursor:pointer}
button.leads-chip-x:hover{opacity:1;background:transparent;color:var(--danger)}
input.leads-chip-in{flex:1 1 120px;width:auto;min-width:80px;min-height:0;padding:3px 2px;border:0;background:transparent;font-size:var(--fs-sm)}
input.leads-chip-in:focus{outline:none}
mark.leads-hl{background:var(--acc-soft);color:var(--acc-ink);padding:0 2px;border-radius:2px}
.leads-f-contact{padding-bottom:8px;white-space:nowrap}
.leads-q-hint{flex:1 1 100%;margin:0}
.leads-per{margin-left:auto;padding-bottom:9px;white-space:nowrap}

.leads-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2);margin-top:var(--s3)}

.leads-sync{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:18px;margin-bottom:var(--s2)}
.leads-sync b{font-weight:600;color:var(--fg);font-variant-numeric:tabular-nums}
.leads-sync.is-err{color:var(--danger)}
.leads-sync-retry{appearance:none;background:none;border:0;padding:0;font:inherit;color:var(--acc);cursor:pointer;text-decoration:underline}
.leads-sync-retry:hover{text-decoration:none}

.leads-body.leads-busy{opacity:.55;pointer-events:none}

.leads-tbl{table-layout:fixed;width:100%}
.leads-tbl col.leads-c1{width:36px}
.leads-tbl col.leads-c2{width:140px}
.leads-tbl col.leads-c4{width:120px}
.leads-tbl col.leads-c5{width:64px}
.leads-tbl col.leads-c6{width:96px}
.leads-tbl col.leads-c7{width:130px}
.leads-tbl col.leads-c8{width:76px}
@media(min-width:641px){.leads-tbl{min-width:900px}}
.leads-tbl th.leads-c-sel,.leads-tbl td.leads-c-sel{padding-right:2px}
.leads-ell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.leads-tbl td.leads-c-ct{padding-left:5px;padding-right:3px;overflow:hidden}
.leads-ct-line{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-xs)}
.leads-hits{display:flex;flex-wrap:wrap;gap:4px}
.leads-time{color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:6px;padding-right:6px}
.leads-tbl tbody tr.leads-row{cursor:pointer}
.leads-tbl tbody tr.leads-row.is-open td{background:var(--row-hover)}
.leads-tbl tbody tr.leads-detail:hover td{background:var(--bg)}
.leads-detail td{background:var(--bg);padding:var(--s3) var(--s4);white-space:normal}
.leads-dt{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:var(--s4);align-items:start}
.leads-full{margin:0;white-space:pre-wrap;word-break:break-word;font-size:var(--fs-sm);border-left:2px solid var(--line);padding-left:var(--s3)}
.leads-dl{display:flex;flex-direction:column;gap:6px;font-size:var(--fs-xs);color:var(--muted)}
.leads-dl b{color:var(--fg);font-weight:600}
.leads-dl a{word-break:break-all}

.leads-foot{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);margin-top:var(--s3);flex-wrap:wrap}

@media(max-width:960px){
  .leads-per{margin-left:0}
  .leads-stats{gap:var(--s4)}
}
@media(max-width:640px){
  .leads-tbl{table-layout:auto;min-width:0}
  .leads-tbl col.leads-c1,.leads-tbl col.leads-c2,.leads-tbl col.leads-c4,.leads-tbl col.leads-c5,
  .leads-tbl col.leads-c6,.leads-tbl col.leads-c7,.leads-tbl col.leads-c8{width:auto}
  .leads-ell{white-space:normal;overflow:visible;text-overflow:clip}
  .leads-time{white-space:normal}
  .leads-dt{grid-template-columns:1fr}
  .leads-f-platform,.leads-f-province{width:100%}
  .leads-bar .leads-chip-field{flex:1 1 auto;min-width:0}
  .leads-detail td{padding:var(--s3)}
  .leads-detail td::before{display:none}
}
`,
  html: `<section class="sec">
  <div class="leads-sync tiny" id="leadsSync" role="status" aria-live="polite">正在同步线索…</div>
  <div class="leads-stats" id="leadsStats"><span class="tiny">统计读取中…</span></div>

  <div class="card leads-bar">
    <label class="field leads-f-platform"><span>平台</span>
      <select id="leadsPlatform"><option value="">全部平台</option></select>
    </label>
    <div class="field leads-f-q leads-chip-field" id="leadsFieldQ">
      <div class="leads-chip-head">
        <span>搜索</span>
        <span class="leads-chip-n tiny" id="leadsQN">共 0 个词</span>
        <span class="leads-chip-acts">
          <button class="ghost sm" type="button" id="leadsQImport">从词库导入</button>
          <button class="ghost sm" type="button" id="leadsQClear" disabled>清空</button>
        </span>
      </div>
      <div class="leads-chips" id="leadsQChips" data-leads-chips="q">
        <input id="leadsQInput" class="leads-chip-in" type="text" autocomplete="off" aria-describedby="leadsQHint" placeholder="评论或昵称，空格 / 逗号 / 回车切词">
      </div>
    </div>
    <label class="field leads-f-province"><span>省份</span>
      <select id="leadsProvince"><option value="">全部地域</option></select>
    </label>
    <label class="check leads-f-contact"><input type="checkbox" id="leadsHasContact"> 只看有联系方式</label>
    <span class="leads-per tiny">每页 50 条</span>
    <p class="hint leads-q-hint" id="leadsQHint">搜索同时匹配评论内容和评论者昵称；每个词块是一个关键词，命中任意一个就算匹配（例：价格 私信 / 批发）。</p>
  </div>

  <div class="leads-actions">
    <button class="primary" type="button" id="leadsExportBtn">导出全部</button>
    <button class="ghost" type="button" id="leadsExportRawBtn">导出完整号码</button>
    <button class="ghost" type="button" id="leadsCandBtn" disabled>加入候选池</button>
  </div>

  <div class="leads-body" id="leadsBody"><p class="loading">读取中…</p></div>
</section>`,
  js: String.raw`
(function(){
  var leadsPageSize=50;
  var leadsEls={
    stats:$('#leadsStats'),
    sync:$('#leadsSync'),
    body:$('#leadsBody'),
    platform:$('#leadsPlatform'),
    qInput:$('#leadsQInput'),
    qChips:$('#leadsQChips'),
    qN:$('#leadsQN'),
    qImportBtn:$('#leadsQImport'),
    qClearBtn:$('#leadsQClear'),
    province:$('#leadsProvince'),
    contact:$('#leadsHasContact'),
    exportBtn:$('#leadsExportBtn'),
    rawBtn:$('#leadsExportRawBtn'),
    candBtn:$('#leadsCandBtn')
  };
  var leadsState={user:'',items:[],total:0,offset:0,selected:{},open:{},error:'',stats:null,statsError:'',platforms:null,seq:0,touch:0,terms:[],hl:[],
    sync:{state:'idle',running:false,platforms:0,names:'',added:0,total:0,error:''}};
  var leadsQTimer=null;
  var leadsIme=false;

  var leadsPlatformNames={xhs:'小红书',douyin:'抖音',kuaishou:'快手',bilibili:'B 站',weibo:'微博',tiktok:'TikTok',x:'X'};
  var leadsProfileBase={xhs:'https://www.xiaohongshu.com/user/profile/',douyin:'https://www.douyin.com/user/',kuaishou:'https://www.kuaishou.com/profile/',bilibili:'https://space.bilibili.com/',weibo:'https://weibo.com/u/',tiktok:'https://www.tiktok.com/@',x:'https://x.com/'};

  /* ---------- 小工具 ---------- */
  function leadsCount(n){
    var value=Number(n);
    if(!isFinite(value))return '0';
    return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  }
  function leadsSafeUrl(url){
    var text=String(url==null?'':url).trim();
    return /^https?:\/\//i.test(text)?text:'';
  }
  function leadsProfileUrl(platform,authorId){
    var id=String(authorId==null?'':authorId);
    if(!id)return '';
    var base=leadsProfileBase[String(platform||'')];
    return base?base+encodeURIComponent(id):'';
  }
  function leadsPlatformPairs(list){
    var out=[];
    if(!list)return out;
    if(!Array.isArray(list)){
      for(var key in list){
        if(!Object.prototype.hasOwnProperty.call(list,key))continue;
        var row=list[key];
        out.push({id:key,name:String(row&&row.name?row.name:key)});
      }
      return out;
    }
    for(var i=0;i<list.length;i++){
      var entry=list[i];
      if(entry==null)continue;
      if(typeof entry==='string'){out.push({id:entry,name:leadsPlatformNames[entry]||entry});continue}
      var id=String(entry.id||entry.platform||'');
      if(!id)continue;
      out.push({id:id,name:String(entry.name||entry.title||leadsPlatformNames[id]||id)});
    }
    return out;
  }
  function leadsPlatformName(id){
    var key=String(id||'');
    var pairs=leadsPlatformPairs(leadsState.platforms);
    for(var i=0;i<pairs.length;i++){if(pairs[i].id===key)return pairs[i].name}
    return leadsPlatformNames[key]||key||'未知平台';
  }

  /* ---------- 词块编辑器（搜索词；交互与采集页一致，命名一律 leads 前缀） ---------- */
  /* 分隔符与后端 / 词库同口径：空白、斜杠、逗号、顿号、分号、竖线。 */
  var leadsChipSep=/[\/,，、;；|\s]/;
  var leadsChipSplit=/[\/,，、;；|\s]+/;

  function leadsChipHtml(term){
    var t=esc(term);
    return '<span class="leads-chip" data-leads-chip="1" title="'+t+'">'+
      '<span class="leads-chip-t">'+t+'</span>'+
      '<button class="leads-chip-x" type="button" data-leads-chip-del="'+t+'" aria-label="删除 '+t+'">×</button>'+
    '</span>';
  }
  /* 输入框里还没按回车的半截词也算一个关键词：边打边搜，不必先切词再查。 */
  function leadsQTyped(){
    return leadsEls.qInput?String(leadsEls.qInput.value||'').trim():'';
  }
  function leadsTerms(){
    var all=leadsState.terms.slice();
    var typed=leadsQTyped();
    if(typed)all=all.concat(typed.split(leadsChipSplit));
    var seen={},out=[];
    for(var i=0;i<all.length;i++){
      var word=String(all[i]==null?'':all[i]).trim().slice(0,40);
      if(!word)continue;
      var key=word.toLowerCase();
      if(seen[key])continue;
      seen[key]=1;
      out.push(word);
    }
    return out;
  }
  /* 提交给后端：词块 join(' ')，后端再按 [\s/]+ 拆开做 OR。 */
  function leadsQValue(){
    return leadsTerms().join(' ');
  }
  function leadsChipControls(){
    var list=leadsState.terms;
    if(leadsEls.qN)leadsEls.qN.textContent='共 '+list.length+' 个词';
    if(leadsEls.qClearBtn)leadsEls.qClearBtn.disabled=!list.length&&!leadsQTyped();
  }
  function leadsChipRender(){
    var box=leadsEls.qChips;
    if(box){
      var old=box.querySelectorAll('[data-leads-chip]');
      for(var i=0;i<old.length;i++)if(old[i].parentNode)old[i].parentNode.removeChild(old[i]);
      if(leadsState.terms.length){
        var html=leadsState.terms.map(leadsChipHtml).join('');
        if(leadsEls.qInput)leadsEls.qInput.insertAdjacentHTML('beforebegin',html);
        else box.insertAdjacentHTML('afterbegin',html);
      }
    }
    leadsChipControls();
  }
  /* 追加词块：忽略大小写去重，单个词最多 40 字（与词库一致）。 */
  function leadsChipAddList(terms){
    var arr=Object.prototype.toString.call(terms)==='[object Array]'?terms:[];
    var seen={};
    leadsState.terms.forEach(function(term){seen[String(term).toLowerCase()]=1});
    var typed=leadsQTyped();
    if(typed){
      typed.split(leadsChipSplit).forEach(function(term){
        var value=String(term==null?'':term).trim();
        if(value)seen[value.toLowerCase()]=1;
      });
    }
    var added=0,skipped=0;
    for(var i=0;i<arr.length;i++){
      var value=String(arr[i]==null?'':arr[i]).trim().slice(0,40);
      if(!value){skipped++;continue}
      var key=value.toLowerCase();
      if(seen[key]){skipped++;continue}
      seen[key]=1;
      leadsState.terms.push(value);
      added++;
    }
    if(added)leadsChipRender();else leadsChipControls();
    return {added:added,skipped:skipped};
  }
  function leadsChipAddTerms(raw){
    var text=String(raw==null?'':raw).trim();
    if(!text)return {added:0,skipped:0};
    return leadsChipAddList(text.split(leadsChipSplit).filter(function(word){return !!word}));
  }
  /* 输入框里出现分隔符就切词；最后一段可能还没打完，留在输入框里。 */
  function leadsChipFlush(input){
    if(!input)return false;
    var value=String(input.value||'');
    if(!leadsChipSep.test(value))return false;
    var parts=value.split(leadsChipSplit);
    var tail=parts.pop()||'';
    input.value=tail;
    if(parts.length)leadsChipAddList(parts);else leadsChipControls();
    return true;
  }
  /* 回车：把输入框里剩下的整段也切成词块。 */
  function leadsChipCommit(input){
    if(!input)return false;
    var value=String(input.value||'').trim();
    input.value='';
    if(value)leadsChipAddTerms(value);else leadsChipControls();
    return true;
  }
  function leadsChipPop(){
    if(!leadsState.terms.length)return;
    leadsState.terms.pop();
    leadsChipRender();
  }
  function leadsChipRemove(term){
    for(var i=0;i<leadsState.terms.length;i++){
      if(leadsState.terms[i]===term){leadsState.terms.splice(i,1);break}
    }
    leadsChipRender();
  }
  function leadsChipClear(){
    leadsState.terms.length=0;
    if(leadsEls.qInput)leadsEls.qInput.value='';
    leadsChipRender();
  }
  /* 从词库导入：GET /api/lexicon 的 filters，去重追加；词库为空只提示，不动现有词块。 */
  function leadsChipImport(btn){
    if(btn)btn.disabled=true;
    return api('/api/lexicon').then(function(result){
      var list=result&&Object.prototype.toString.call(result.filters)==='[object Array]'?result.filters:[];
      if(!list.length){
        toast('词库里还没有筛选词','');
        return;
      }
      var res=leadsChipAddList(list);
      if(!res.added){
        toast('词库里的 '+list.length+' 个词都已经在了','');
        return;
      }
      toast('从词库导入 '+res.added+' 个词'+(res.skipped?'，跳过 '+res.skipped+' 个重复':''),'ok');
      leadsQNow();
    },function(error){
      toast('词库读取失败：'+((error&&error.message)||'请求失败'),'err');
    }).then(function(){
      if(btn)btn.disabled=false;
      leadsChipControls();
    });
  }
  /* 词块增删是显式动作，立刻查；只有打字才走 300ms 防抖。 */
  function leadsQNow(){
    if(leadsQTimer){clearTimeout(leadsQTimer);leadsQTimer=null}
    leadsFilterChanged();
  }
  function leadsQSoon(){
    if(leadsQTimer)clearTimeout(leadsQTimer);
    leadsQTimer=setTimeout(function(){leadsQTimer=null;leadsFilterChanged()},300);
  }

  /* ---------- 高亮（评论 / 评论者 / 详情原文） ---------- */
  /* 正文先当纯文本，只为命中片段套 <mark>；关键词当字面量拼进正则（大小写不敏感），
     所以正文里的 < > & " 不会变成标签，词里的正则元字符也不会生效。 */
  function leadsHl(text,tokens){
    var raw=String(text==null?'':text);
    if(!raw)return '';
    var seen={},list=[];
    var source=Object.prototype.toString.call(tokens)==='[object Array]'?tokens:[];
    for(var i=0;i<source.length;i++){
      var value=String(source[i]==null?'':source[i]).trim().slice(0,40);
      if(!value)continue;
      var key=value.toLowerCase();
      if(seen[key])continue;
      seen[key]=1;
      list.push(value);
    }
    if(!list.length)return esc(raw);
    list.sort(function(a,b){return b.length-a.length});
    var re;
    try{
      re=new RegExp('('+list.map(function(term){return term.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&')}).join('|')+')','gi');
    }catch(e){
      return esc(raw);
    }
    var out='',pos=0,hits=0,m;
    while((m=re.exec(raw))!==null&&hits<500){
      if(!m[0]){re.lastIndex++;continue}
      out+=esc(raw.slice(pos,m.index))+'<mark class="leads-hl">'+esc(m[0])+'</mark>';
      pos=m.index+m[0].length;
      hits++;
    }
    out+=esc(raw.slice(pos));
    return out;
  }

  /* ---------- 筛选参数 ---------- */
  /* 后端把 q 按 [\s/]+ 拆开做 OR 匹配；前端把词块 join(' ') 发出去，文案用同一份词表。 */
  function leadsHasFilter(){
    return !!(leadsEls.platform.value||leadsQValue()||leadsEls.province.value||leadsEls.contact.checked);
  }
  function leadsFilterText(){
    var parts=[];
    if(leadsEls.platform.value)parts.push('平台 '+leadsPlatformName(leadsEls.platform.value));
    var keywords=leadsTerms();
    if(keywords.length===1)parts.push('关键词「'+keywords[0]+'」');
    else if(keywords.length>1)parts.push('关键词「'+keywords.join('」「')+'」（命中任意一个）');
    if(leadsEls.province.value)parts.push('省份 '+leadsEls.province.value);
    if(leadsEls.contact.checked)parts.push('只看有联系方式');
    return parts.length?('当前筛选：'+parts.join(' · ')):'';
  }
  function leadsParams(){
    var out=[];
    if(leadsEls.platform.value)out.push('platform='+encodeURIComponent(leadsEls.platform.value));
    var q=leadsQValue();
    if(q)out.push('q='+encodeURIComponent(q));
    if(leadsEls.province.value)out.push('province='+encodeURIComponent(leadsEls.province.value));
    if(leadsEls.contact.checked)out.push('hasContact=1');
    return out;
  }
  function leadsExportUrl(options){
    var opts=options||{};
    var params=leadsParams();
    if(opts.ids&&opts.ids.length)params.push('ids='+opts.ids.map(encodeURIComponent).join(','));
    if(opts.mask===false)params.push('mask=0');
    return '/api/leads/export.csv'+(params.length?('?'+params.join('&')):'');
  }
  function leadsSelectedIds(){
    var out=[];
    for(var key in leadsState.selected){
      if(Object.prototype.hasOwnProperty.call(leadsState.selected,key)&&leadsState.selected[key])out.push(key);
    }
    return out;
  }
  function leadsDownload(url){
    var anchor=document.createElement('a');
    anchor.href=url;
    anchor.rel='noopener';
    anchor.style.display='none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  /* ---------- 联系方式脱敏（与后端 toCsv 的规则一致） ---------- */
  function leadsMaskContact(contact){
    var value=String(contact&&contact.value?contact.value:'');
    if(contact&&contact.type==='phone')return value.length<8?value:(value.slice(0,3)+'****'+value.slice(-4));
    if(value.length<=5)return value;
    var stars='';
    for(var i=0;i<value.length-4;i++)stars+='*';
    return value.slice(0,2)+stars+value.slice(-2);
  }
  function leadsContactCell(contacts){
    var list=[];
    var raw=Array.isArray(contacts)?contacts:[];
    for(var i=0;i<raw.length;i++){if(raw[i]&&raw[i].value)list.push(raw[i])}
    if(!list.length)return {html:'<span class="tiny">—</span>',title:''};
    var texts=list.map(function(contact){return String(contact.type)+':'+leadsMaskContact(contact)});
    return {
      html:texts.map(function(text){return '<span class="leads-ct-line">'+esc(text)+'</span>'}).join(''),
      title:texts.join(' / ')
    };
  }

  /* ---------- 渲染 ---------- */
  function leadsRenderStats(){
    var stats=leadsState.stats;
    if(!stats){
      leadsEls.stats.innerHTML='<span class="tiny">'+(leadsState.statsError?('统计读取失败：'+esc(leadsState.statsError)):'统计读取中…')+'</span>';
      return;
    }
    var provinces=Array.isArray(stats.provinces)?stats.provinces:[];
    leadsEls.stats.innerHTML=
      '<span class="leads-stat"><b class="num">'+leadsCount(stats.total)+'</b><span>总条数</span></span>'+
      '<span class="leads-stat"><b class="num">'+leadsCount(stats.withContact)+'</b><span>有联系方式条数</span></span>'+
      '<span class="leads-stat"><b class="num">'+leadsCount(provinces.length)+'</b><span>覆盖省份数</span></span>'+
      '<span class="leads-stat-note">全库口径，不随筛选变化</span>'+
      (leadsState.statsError?'<span class="leads-stat-note">（统计读取失败，显示上次结果）</span>':'');
  }
  function leadsRenderActions(){
    var picked=leadsSelectedIds().length;
    leadsEls.exportBtn.textContent=picked?('导出选中 ('+picked+')'):'导出全部';
    leadsEls.exportBtn.disabled=!picked&&leadsState.total===0;
    leadsEls.rawBtn.disabled=leadsState.total===0;
    if(leadsEls.candBtn){
      leadsEls.candBtn.textContent=picked?('加入候选池 ('+picked+')'):'加入候选池';
      leadsEls.candBtn.disabled=!picked;
    }
  }
  function leadsDetailHtml(lead){
    var itemTitle=lead.item_title||'';
    var itemUrl=leadsSafeUrl(lead.item_url);
    var item=itemUrl
      ?('<a href="'+esc(itemUrl)+'" target="_blank" rel="noopener">'+esc(itemTitle||itemUrl)+'</a>')
      :(itemTitle?esc(itemTitle):'<span class="tiny">无</span>');
    var profile=leadsProfileUrl(lead.platform,lead.author_id);
    var who=lead.author_name||lead.author_id||'';
    var author=profile
      ?('<a href="'+esc(profile)+'" target="_blank" rel="noopener">'+esc(who||profile)+'</a>')
      :(who?esc(who):'<span class="tiny">无</span>');
    var full=leadsHl(lead.text||'',leadsState.hl);
    return '<div class="leads-dt">'+
      '<p class="leads-full">'+(full||'（空）')+'</p>'+
      '<div class="leads-dl">'+
        '<div><span class="tiny">平台</span> <b>'+esc(leadsPlatformName(lead.platform))+'</b></div>'+
        '<div><span class="tiny">作品</span> '+item+'</div>'+
        '<div><span class="tiny">作者主页</span> '+author+'</div>'+
        '<div><span class="tiny">评论时间</span> <span class="num">'+esc(fmtTime(lead.created_at)||'未知')+'</span></div>'+
        '<div><span class="tiny">采集时间</span> <span class="num">'+esc(fmtTime(lead.collected_at)||'未知')+'</span></div>'+
      '</div>'+
    '</div>';
  }
  function leadsRowHtml(lead){
    var id=String(lead.id||'');
    var name=lead.author_name||lead.author_id||'匿名';
    var text=String(lead.text||'');
    var picked=leadsState.selected[id]?' checked':'';
    var open=!!leadsState.open[id];
    var contacts=leadsContactCell(lead.contacts);
    var tokens=leadsState.hl;
    var cells=[
      '<td class="leads-c-sel" data-label="选择"><input type="checkbox" class="leads-pick" data-id="'+esc(id)+'"'+picked+' aria-label="选中 '+esc(name)+'"></td>',
      '<td class="leads-ell" data-label="评论者" title="'+esc(name)+'">'+leadsHl(name,tokens)+'</td>',
      '<td class="leads-ell" data-label="评论" title="'+esc(text)+'">'+leadsHl(text,tokens)+'</td>',
      '<td class="leads-c-ct" data-label="联系方式" title="'+esc(contacts.title)+'"><div class="leads-ct">'+contacts.html+'</div></td>',
      '<td class="leads-ell" data-label="地域">'+(lead.province?esc(lead.province):'<span class="tiny">—</span>')+'</td>',
      '<td class="leads-time" data-label="时间">'+(lead.created_at?esc(fmtTime(lead.created_at)):'<span class="tiny">—</span>')+'</td>',
      '<td data-label="操作"><button type="button" class="sm ghost" data-act="detail" aria-expanded="'+(open?'true':'false')+'">'+(open?'收起':'详情')+'</button></td>'
    ];
    return '<tr class="leads-row'+(open?' is-open':'')+'" data-id="'+esc(id)+'">'+cells.join('')+'</tr>'+
      '<tr class="leads-detail" data-detail="'+esc(id)+'"'+(open?'':' hidden')+'><td colspan="7" data-label="">'+leadsDetailHtml(lead)+'</td></tr>';
  }
  function leadsPagerHtml(){
    var pages=Math.max(1,Math.ceil(leadsState.total/leadsPageSize));
    var page=Math.floor(leadsState.offset/leadsPageSize)+1;
    if(page>pages)page=pages;
    return '<div class="leads-foot">'+
      '<span class="sub num">共 '+leadsCount(leadsState.total)+' 条 · 第 '+page+'/'+pages+' 页</span>'+
      '<div class="row">'+
        '<button type="button" class="sm" id="leadsPrev"'+(page<=1?' disabled':'')+'>上一页</button>'+
        '<button type="button" class="sm" id="leadsNext"'+(page>=pages?' disabled':'')+'>下一页</button>'+
      '</div>'+
    '</div>';
  }
  function leadsTableHtml(){
    var rows=[];
    for(var i=0;i<leadsState.items.length;i++)rows.push(leadsRowHtml(leadsState.items[i]));
    return '<div class="tbl-wrap"><table class="tbl leads-tbl">'+
      '<colgroup><col class="leads-c1"><col class="leads-c2"><col><col class="leads-c4"><col class="leads-c5"><col class="leads-c7"><col class="leads-c8"></colgroup>'+
      '<thead><tr>'+
        '<th class="leads-c-sel"><input type="checkbox" id="leadsPickAll" aria-label="全选本页" title="全选本页"></th>'+
        '<th>评论者</th><th>评论</th><th>联系方式</th><th>地域</th><th>时间</th><th>操作</th>'+
      '</tr></thead>'+
      '<tbody>'+rows.join('')+'</tbody>'+
    '</table></div>'+leadsPagerHtml();
  }
  function leadsEmptyHtml(){
    if(leadsHasFilter()){
      return '<div class="empty">'+
        '<b>没有符合筛选条件的线索</b>'+
        '<p class="sub">'+esc(leadsFilterText())+'</p>'+
        '<button class="btn" type="button" id="leadsClearFilters">清空筛选</button>'+
      '</div>';
    }
    return '<div class="empty">'+
      '<b>还没有线索</b>'+
      '<p class="sub">先去采集页采一批评论，回到这页会自动同步成线索。</p>'+
      '<button class="btn" type="button" id="leadsGoCrawl">去采集</button>'+
    '</div>';
  }
  function leadsErrorHtml(){
    return '<div class="empty">'+
      '<b>线索加载失败</b>'+
      '<p class="sub">'+esc(leadsState.error||'请求失败')+'</p>'+
      '<button class="btn" type="button" id="leadsRetry">重试</button>'+
    '</div>';
  }
  function leadsSyncSelection(){
    var picks=leadsEls.body.querySelectorAll('.leads-pick');
    var all=picks.length>0;
    var some=false;
    for(var i=0;i<picks.length;i++){
      if(picks[i].checked)some=true;else all=false;
    }
    var head=$('#leadsPickAll');
    if(head){
      head.checked=all;
      head.indeterminate=!all&&some;
      head.disabled=!picks.length;
    }
    leadsRenderActions();
  }
  function leadsRender(){
    leadsRenderStats();
    leadsRenderActions();
    if(leadsState.error){leadsEls.body.innerHTML=leadsErrorHtml();return}
    if(!leadsState.items.length){leadsEls.body.innerHTML=leadsEmptyHtml();return}
    leadsEls.body.innerHTML=leadsTableHtml();
    leadsSyncSelection();
  }

  /* ---------- 数据 ---------- */
  function leadsLoad(){
    var seq=++leadsState.seq;
    leadsState.error='';
    /* 高亮词与这次请求的 q 同源，回来渲染时不跟着输入框继续变。 */
    leadsState.hl=leadsTerms();
    leadsEls.body.classList.add('leads-busy');
    if(!leadsState.items.length)leadsEls.body.innerHTML='<p class="loading">读取中…</p>';
    var params=leadsParams();
    params.push('limit='+leadsPageSize);
    params.push('offset='+leadsState.offset);
    return api('/api/leads?'+params.join('&')).then(function(result){
      if(seq!==leadsState.seq)return;
      leadsEls.body.classList.remove('leads-busy');
      var items=Array.isArray(result.items)?result.items:[];
      leadsState.items=items;
      leadsState.total=Number(result.total||0);
      if(!items.length&&leadsState.total>0&&leadsState.offset>0){
        leadsState.offset=Math.max(0,Math.floor((leadsState.total-1)/leadsPageSize)*leadsPageSize);
        return leadsLoad();
      }
      leadsRender();
    },function(error){
      if(seq!==leadsState.seq)return;
      leadsEls.body.classList.remove('leads-busy');
      leadsState.items=[];
      leadsState.total=0;
      leadsState.selected={};
      leadsState.error=(error&&error.message)||'请求失败';
      leadsRender();
    });
  }
  function leadsLoadStats(){
    return api('/api/leads/stats').then(function(stats){
      leadsState.stats={
        total:Number(stats.total||0),
        withContact:Number(stats.withContact||0),
        provinces:Array.isArray(stats.provinces)?stats.provinces:[]
      };
      leadsState.statsError='';
      leadsFillProvinces(leadsState.stats.provinces);
      leadsRenderStats();
    },function(error){
      leadsState.statsError=(error&&error.message)||'读取失败';
      leadsRenderStats();
    });
  }
  function leadsLoadPlatforms(){
    var shared=omc.state&&omc.state.platforms;
    if(shared&&(!Array.isArray(shared)||shared.length)){
      leadsState.platforms=shared;
      leadsFillPlatforms();
      return Promise.resolve();
    }
    return api('/api/platforms').then(function(list){
      leadsState.platforms=list;
      leadsFillPlatforms();
    },function(){
      leadsFillPlatforms();
    });
  }

  /* ---------- 自动同步（进页面就跑，不挡筛选；列表不等它） ---------- */
  function leadsSyncRender(){
    var sync=leadsState.sync;
    var el=leadsEls.sync;
    if(!el)return;
    el.title='';
    if(sync.running){
      el.className='leads-sync tiny';
      el.innerHTML='正在同步线索…';
      return;
    }
    if(sync.state==='error'){
      el.className='leads-sync tiny is-err';
      el.innerHTML='自动同步失败：'+esc(sync.error||'请求失败')+'（不影响下面的列表）'+
        '<button type="button" class="leads-sync-retry" id="leadsSyncRetry">重试</button>';
      return;
    }
    if(sync.state==='ok'){
      el.className='leads-sync tiny';
      el.innerHTML='已自动同步：<b class="num">'+leadsCount(sync.platforms)+'</b> 个平台 / '+
        (sync.added>0?('新增 <b class="num">'+leadsCount(sync.added)+'</b> 条'):'已是最新');
      el.title=(sync.names?sync.names+' · ':'')+'线索库共 '+leadsCount(sync.total)+' 条';
      return;
    }
    el.className='leads-sync tiny';
    el.innerHTML='正在同步线索…';
  }
  function leadsSync(){
    var sync=leadsState.sync;
    if(sync.running)return Promise.resolve();
    sync.running=true;
    sync.state='running';
    sync.error='';
    leadsSyncRender();
    var touchAtStart=leadsState.touch;
    return post('/api/leads/sync',{}).then(function(result){
      sync.running=false;
      sync.state='ok';
      var list=Array.isArray(result.platforms)?result.platforms:[];
      sync.platforms=list.length;
      sync.names=list.map(function(id){return leadsPlatformName(id)}).join(' / ');
      sync.added=Number(result.added||0);
      sync.total=Number(result.total||0);
      leadsSyncRender();
      if(!sync.added)return;
      leadsLoadStats();
      // 同步期间用户改过筛选 / 翻页就别抢焦点，只刷新统计
      if(leadsState.touch===touchAtStart)leadsLoad();
    },function(error){
      sync.running=false;
      sync.state='error';
      sync.error=(error&&error.message)||'请求失败';
      leadsSyncRender();
    });
  }

  /* ---------- 下拉框 ---------- */
  function leadsFillPlatforms(){
    var pairs=leadsPlatformPairs(leadsState.platforms);
    var current=leadsEls.platform.value;
    var options=['<option value="">全部平台</option>'];
    var found=false;
    for(var i=0;i<pairs.length;i++){
      if(pairs[i].id===current)found=true;
      options.push('<option value="'+esc(pairs[i].id)+'">'+esc(pairs[i].name)+'</option>');
    }
    leadsEls.platform.innerHTML=options.join('');
    leadsEls.platform.value=found?current:'';
  }
  function leadsFillProvinces(provinces){
    var current=leadsEls.province.value;
    var list=Array.isArray(provinces)?provinces:[];
    var options=['<option value="">全部地域</option>'];
    var found=false;
    for(var i=0;i<list.length;i++){
      var name=String(list[i]);
      if(name===current)found=true;
      options.push('<option value="'+esc(name)+'">'+esc(name)+'</option>');
    }
    if(current&&!found){
      found=true;
      options.push('<option value="'+esc(current)+'">'+esc(current)+'</option>');
    }
    leadsEls.province.innerHTML=options.join('');
    leadsEls.province.value=found?current:'';
  }

  /* ---------- 交互 ---------- */
  function leadsFilterChanged(){
    if(leadsQTimer){clearTimeout(leadsQTimer);leadsQTimer=null}
    leadsState.touch++;
    leadsState.offset=0;
    leadsState.selected={};
    leadsState.open={};
    leadsLoad();
  }
  function leadsPageBy(direction){
    var pages=Math.max(1,Math.ceil(leadsState.total/leadsPageSize));
    var page=Math.floor(leadsState.offset/leadsPageSize)+1+direction;
    if(page<1||page>pages)return;
    leadsState.touch++;
    leadsState.offset=(page-1)*leadsPageSize;
    leadsLoad();
  }
  function leadsClearFilters(){
    leadsEls.platform.value='';
    leadsChipClear();
    leadsEls.province.value='';
    leadsEls.contact.checked=false;
    leadsFilterChanged();
  }
  function leadsToggleDetail(id){
    if(!id)return;
    var body=leadsEls.body;
    var rows=body.querySelectorAll('tr.leads-row');
    var row=null;
    for(var i=0;i<rows.length;i++){
      if(rows[i].getAttribute('data-id')===id){row=rows[i];break}
    }
    if(!row)return;
    var open=!leadsState.open[id];
    if(open)leadsState.open[id]=1;else delete leadsState.open[id];
    var details=body.querySelectorAll('tr.leads-detail');
    for(var j=0;j<details.length;j++){
      if(details[j].getAttribute('data-detail')===id){
        if(open)details[j].removeAttribute('hidden');else details[j].setAttribute('hidden','');
        break;
      }
    }
    if(open)row.classList.add('is-open');else row.classList.remove('is-open');
    var button=row.querySelector('button[data-act="detail"]');
    if(button){
      button.textContent=open?'收起':'详情';
      button.setAttribute('aria-expanded',open?'true':'false');
    }
  }
  function leadsReset(){
    leadsState.user=omc.state&&omc.state.me?omc.state.me.username:'';
    leadsState.items=[];
    leadsState.total=0;
    leadsState.offset=0;
    leadsState.selected={};
    leadsState.open={};
    leadsState.error='';
    leadsState.stats=null;
    leadsState.statsError='';
    leadsState.platforms=null;
    leadsState.seq++;
    leadsState.touch=0;
    leadsState.terms.length=0;
    leadsState.hl=[];
    leadsState.sync={state:'idle',running:false,platforms:0,names:'',added:0,total:0,error:''};
    leadsEls.body.classList.remove('leads-busy');
    leadsEls.body.innerHTML='<p class="loading">读取中…</p>';
    leadsChipClear();
    leadsEls.contact.checked=false;
    leadsFillProvinces([]);
    leadsRenderStats();
    leadsRenderActions();
    leadsSyncRender();
  }

  leadsEls.platform.addEventListener('change',leadsFilterChanged);
  leadsEls.province.addEventListener('change',leadsFilterChanged);
  leadsEls.contact.addEventListener('change',leadsFilterChanged);

  /* 词块：空格 / 斜杠 / 逗号 / 顿号切词，回车收尾，Backspace 删最后一个，× 单删，整串粘贴切词。 */
  if(leadsEls.qInput){
    leadsEls.qInput.addEventListener('input',function(event){
      if(event.isComposing||leadsIme)return;
      leadsChipFlush(leadsEls.qInput);
      leadsChipControls();
      leadsQSoon();
    });
    leadsEls.qInput.addEventListener('keydown',function(event){
      if(event.isComposing||leadsIme)return;
      var input=leadsEls.qInput;
      if(event.key==='Enter'){
        event.preventDefault();
        leadsChipCommit(input);
        leadsQNow();
        return;
      }
      if(event.key==='Backspace'&&!String(input.value||'')){
        if(!leadsState.terms.length)return;
        event.preventDefault();
        leadsChipPop();
        leadsQNow();
        return;
      }
      if(event.key==='Escape'&&(leadsState.terms.length||String(input.value||''))){
        event.preventDefault();
        leadsChipClear();
        leadsQNow();
      }
    });
    leadsEls.qInput.addEventListener('paste',function(event){
      var data=event.clipboardData||window.clipboardData;
      var text=data&&data.getData?String(data.getData('text')||''):'';
      if(!text||!leadsChipSep.test(text))return;
      event.preventDefault();
      leadsChipAddTerms(text);
      leadsQNow();
    });
    /* 中文输入法拼写过程中的空格 / 回车不切词 */
    leadsEls.qInput.addEventListener('compositionstart',function(){leadsIme=true});
    leadsEls.qInput.addEventListener('compositionend',function(){
      leadsIme=false;
      leadsChipFlush(leadsEls.qInput);
      leadsChipControls();
      leadsQSoon();
    });
  }
  if(leadsEls.qChips)leadsEls.qChips.addEventListener('click',function(event){
    var target=event.target;
    if(!target||!target.closest)return;
    var del=target.closest('[data-leads-chip-del]');
    if(del){
      leadsChipRemove(del.getAttribute('data-leads-chip-del')||'');
      leadsQNow();
      if(leadsEls.qInput)leadsEls.qInput.focus();
      return;
    }
    if(leadsEls.qInput&&target!==leadsEls.qInput)leadsEls.qInput.focus();
  });
  if(leadsEls.qImportBtn)leadsEls.qImportBtn.addEventListener('click',function(){leadsChipImport(leadsEls.qImportBtn)});
  if(leadsEls.qClearBtn)leadsEls.qClearBtn.addEventListener('click',function(){
    leadsChipClear();
    leadsQNow();
    if(leadsEls.qInput)leadsEls.qInput.focus();
  });
  leadsChipRender();

  leadsEls.exportBtn.addEventListener('click',function(){
    var ids=leadsSelectedIds();
    if(ids.length){
      leadsDownload(leadsExportUrl({ids:ids}));
      toast('正在导出选中的 '+ids.length+' 条');
      return;
    }
    leadsDownload(leadsExportUrl({}));
    toast('正在导出当前筛选结果');
  });
  leadsEls.rawBtn.addEventListener('click',function(){
    var ids=leadsSelectedIds();
    var scope=ids.length?('选中 '+ids.length+' 条'):'当前筛选全部';
    if(!window.confirm('导出'+scope+'，CSV 里是完整手机号 / 微信号（明文保存）。确定继续？'))return;
    leadsDownload(leadsExportUrl({ids:ids,mask:false}));
    toast('正在导出完整号码');
  });
  /* 勾选的线索直接进私信候选池，之后到「触达」页就能按候选池群发。 */
  if(leadsEls.candBtn)leadsEls.candBtn.addEventListener('click',async function(){
    var ids=leadsSelectedIds();
    if(!ids.length){toast('先勾选线索','err');return}
    var btn=leadsEls.candBtn;
    btn.disabled=true;
    var label=btn.textContent;
    btn.textContent='加入中…';
    try{
      var r=await post('/api/leads/candidates',{ids:ids});
      var parts=['新增 '+leadsCount(r.added),'重复 '+leadsCount(r.skipped)];
      if(r.missing)parts.push('缺作者 '+leadsCount(r.missing));
      toast('已加入私信候选池：'+parts.join(' · '),'ok');
      leadsState.selected={};
      var picks=leadsEls.body.querySelectorAll('.leads-pick');
      for(var i=0;i<picks.length;i++)picks[i].checked=false;
      var all=$('#leadsPickAll');
      if(all)all.checked=false;
      leadsSyncSelection();
    }catch(e){
      toast('加入候选池失败：'+e.message,'err');
    }finally{
      btn.textContent=label;
      leadsRenderActions();
    }
  });
  leadsEls.sync.addEventListener('click',function(event){
    var target=event.target;
    if(target&&target.closest&&target.closest('#leadsSyncRetry'))leadsSync();
  });

  leadsEls.body.addEventListener('click',function(event){
    var target=event.target;
    if(!target||!target.closest)return;
    if(target.closest('#leadsRetry')){leadsLoad();return}
    if(target.closest('#leadsClearFilters')){leadsClearFilters();return}
    if(target.closest('#leadsGoCrawl')){omc.go('crawl');return}
    var prev=target.closest('#leadsPrev');
    if(prev){if(!prev.disabled)leadsPageBy(-1);return}
    var next=target.closest('#leadsNext');
    if(next){if(!next.disabled)leadsPageBy(1);return}
    var detailButton=target.closest('button[data-act="detail"]');
    if(detailButton){
      var ownRow=detailButton.closest('tr.leads-row');
      if(ownRow)leadsToggleDetail(ownRow.getAttribute('data-id'));
      return;
    }
    if(target.closest('tr.leads-detail, a, input'))return;
    var row=target.closest('tr.leads-row');
    if(row)leadsToggleDetail(row.getAttribute('data-id'));
  });
  leadsEls.body.addEventListener('change',function(event){
    var target=event.target;
    if(!target)return;
    if(target.id==='leadsPickAll'){
      var on=!!target.checked;
      var picks=leadsEls.body.querySelectorAll('.leads-pick');
      for(var i=0;i<picks.length;i++){
        picks[i].checked=on;
        var pickId=picks[i].getAttribute('data-id');
        if(!pickId)continue;
        if(on)leadsState.selected[pickId]=1;else delete leadsState.selected[pickId];
      }
      leadsSyncSelection();
      return;
    }
    if(target.classList&&target.classList.contains('leads-pick')){
      var id=target.getAttribute('data-id');
      if(!id)return;
      if(target.checked)leadsState.selected[id]=1;else delete leadsState.selected[id];
      leadsSyncSelection();
    }
  });

  omc.onShow('leads',function(){
    var who=omc.state&&omc.state.me?omc.state.me.username:'';
    if(who!==leadsState.user)leadsReset();
    // 列表 / 统计先发，不等同步：同步慢也只是顶部那行在转，筛选随时可用。
    leadsLoad();
    leadsLoadStats();
    leadsLoadPlatforms();
    leadsSync();
  });
})();
`,
}
