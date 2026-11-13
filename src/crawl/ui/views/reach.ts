import type { View } from '../types.js'

/**
 * 触达：两个 tab ——「候选与群发」（候选池 / 群发 / 任务 / 单条互动）与
 * 「私信会话」（会话列表 + 聊天窗口）。
 *
 * 所有标识符（函数 / 变量 / HTML id / class）都带 reach 前缀：各视图的 js
 * 拼在同一个 <script> 里共享作用域，不加前缀会互相覆盖。
 */
export const reach: View = {
  id: 'reach',
  nav: '触达',
  title: '触达',
  sub: '候选池统一回复或私信，按间隔逐条发送；私信会话按人聊。',

  css: String.raw`
.reach-bar{margin-bottom:var(--s2)}
.reach-f2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2)}
.reach-form{display:flex;flex-direction:column;gap:var(--s3);margin-top:var(--s3)}
.reach-pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:var(--s2) var(--s3);margin:var(--s2) 0 0;min-height:96px;max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:var(--fs-xs);line-height:1.7;color:var(--fg)}
.tbl tbody tr.reach-logrow:hover td{background:transparent}
.reach-logrow>td{padding-top:0;padding-bottom:var(--s3)}
.reach-logrow .reach-pre{margin:0}
.reach-det>summary{cursor:pointer;display:flex;align-items:baseline;gap:var(--s2);font-weight:600;font-size:var(--fs-lg);list-style:none}
.reach-det>summary::-webkit-details-marker{display:none}
.reach-det>summary::before{content:"▸";color:var(--muted);font-size:var(--fs-sm)}
.reach-det[open]>summary::before{content:"▾"}
.reach-det>summary .sub{font-weight:400}
.reach-act{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s3);margin-top:var(--s3)}
.reach-act .full{grid-column:1/-1}
@media(max-width:640px){.reach-act{grid-template-columns:1fr}}

/* 分栏 tab */
.reach-tabs{display:flex;align-items:center;gap:var(--s1);border-bottom:1px solid var(--line);margin-bottom:var(--s4)}
.reach-tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;border-radius:0;min-height:34px;padding:6px 12px;color:var(--muted);font-weight:600}
.reach-tab:hover{background:var(--row-hover);color:var(--fg)}
.reach-tab.is-on,.reach-tab.is-on:hover{color:var(--acc-ink);background:transparent;border-bottom-color:var(--acc)}

/* 候选行操作 */
.reach-cand-ops{display:flex;align-items:center;gap:var(--s2);white-space:nowrap}

/* 私信会话 */
.reach-chat{display:grid;grid-template-columns:260px minmax(0,1fr);gap:var(--s3);height:min(70vh,660px)}
.reach-threads{display:flex;flex-direction:column;gap:var(--s1);min-width:0;min-height:0;padding:var(--s2)}
.reach-threads-head{padding:var(--s1) var(--s2) 0}
.reach-thread-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:2px}
.reach-th{display:block;flex:none;width:100%;text-align:left;background:none;border:1px solid transparent;border-left:2px solid transparent;border-radius:4px;padding:7px 9px;min-height:0;justify-content:flex-start;font-weight:400;color:var(--fg)}
.reach-th:hover{background:var(--row-hover)}
.reach-th.is-on,.reach-th.is-on:hover{background:var(--acc-soft);border-left-color:var(--acc)}
.reach-th-top{display:flex;align-items:center;gap:6px;min-width:0}
.reach-th-name{font-size:var(--fs-sm);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.reach-th-top .badge{flex:none}
.reach-th-last{display:block;font-size:var(--fs-xs);color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reach-th.is-on .reach-th-last{color:var(--acc-ink)}
.reach-th-meta{display:flex;justify-content:space-between;gap:var(--s2);font-size:var(--fs-xs);color:var(--muted);margin-top:2px}
.reach-th-empty{flex:1;display:flex;flex-direction:column;justify-content:center}

.reach-chat-main{display:flex;flex-direction:column;min-width:0;min-height:0;padding:0}
.reach-chat-head{display:flex;align-items:center;gap:var(--s2);padding:var(--s2) var(--s3);border-bottom:1px solid var(--line);flex-wrap:wrap}
.reach-chat-peer{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 160px}
.reach-chat-peer>b{font-size:var(--fs);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reach-msgs{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:var(--s3);background:var(--bg)}
.reach-msgs-empty{display:flex;flex-direction:column;justify-content:center;height:100%}
.reach-msg{display:flex;margin-bottom:var(--s2)}
.reach-msg.is-out{justify-content:flex-end}
.reach-msg.is-in{justify-content:flex-start}
.reach-bub{max-width:78%;border:1px solid var(--line);border-radius:8px;background:var(--card);padding:var(--s2) var(--s3);word-break:break-word}
.reach-msg.is-out .reach-bub{background:var(--acc-soft);border-color:var(--acc-soft)}
.reach-bub.is-fail,.reach-msg.is-out .reach-bub.is-fail{background:var(--card);border-color:var(--danger)}
.reach-bub-text{white-space:pre-wrap;font-size:var(--fs-sm);line-height:1.6}
.reach-bub-meta{display:flex;justify-content:flex-end;gap:var(--s2);font-size:var(--fs-xs);color:var(--muted);margin-top:2px}
.reach-bub-fail{color:var(--danger);font-weight:600}
.reach-chat-note{margin:0;padding:var(--s2) var(--s3) 0;font-size:var(--fs-xs);color:var(--muted);word-break:break-word}
.reach-chat-note.is-err{color:var(--danger)}
.reach-composer{display:flex;flex-direction:column;gap:var(--s2);padding:var(--s2) var(--s3) var(--s3);border-top:1px solid var(--line)}
.reach-composer textarea{resize:vertical;min-height:52px;max-height:160px}
.reach-comp-bar{display:flex;align-items:center;gap:var(--s2)}
@media(max-width:960px){
  .reach-chat{grid-template-columns:minmax(0,1fr);height:auto;gap:var(--s2)}
  .reach-thread-list{height:40vh;flex:none}
  .reach-msgs{height:52vh;flex:none}
}
`,

  html: String.raw`
<div class="reach-tabs" id="reachTabs" role="tablist" aria-label="触达分栏">
  <button class="reach-tab is-on" id="reachTabCand" type="button" role="tab" aria-selected="true" aria-controls="reachPanelCand" data-reach-tab="cand">候选与群发</button>
  <button class="reach-tab" id="reachTabChat" type="button" role="tab" aria-selected="false" aria-controls="reachPanelChat" data-reach-tab="chat">私信会话</button>
</div>

<div id="reachPanelCand" role="tabpanel" aria-labelledby="reachTabCand">
<section class="sec">
  <div class="sec-head">
    <h2>候选池与群发</h2>
    <span class="sub">候选来自采集页的评论；回复候选记一条评论，私信候选记评论作者。</span>
  </div>
  <div class="grid2">
    <div class="card">
      <div class="row reach-bar">
        <button class="danger sm" id="reachCandBulk" type="button">移除所选</button>
        <button class="ghost sm" id="reachClearReply" type="button">清空回复候选</button>
        <button class="ghost sm" id="reachClearDm" type="button">清空私信候选</button>
        <span class="spacer"></span>
        <span class="tiny" id="reachCandSummary">读取中…</span>
      </div>
      <div class="tbl-wrap" id="reachCandWrap" hidden>
        <table class="tbl">
          <thead><tr>
            <th class="sel"><input type="checkbox" id="reachCandAll" aria-label="全选候选"></th>
            <th>类型</th><th>平台</th><th>对象</th><th>备注</th><th></th>
          </tr></thead>
          <tbody id="reachCandBody"></tbody>
        </table>
      </div>
      <div class="empty" id="reachCandEmpty" hidden>
        <b>候选池还是空的</b>
        <span>去采集页，在评论上点「加候选」；回复候选会记下那条评论，私信候选会记下评论作者。</span>
        <div><button class="btn ghost sm" id="reachGoCrawl" type="button">去采集页</button></div>
      </div>
      <p class="hint" id="reachCandMsg" hidden></p>
    </div>

    <div class="card">
      <h2>群发设置</h2>
      <form id="reachCampForm" class="reach-form">
        <label class="field"><span>类型</span>
          <select id="reachCampType">
            <option value="dm" selected>统一私信</option>
            <option value="reply">统一回复（回复他们那条评论）</option>
          </select>
        </label>
        <label class="field"><span>文案</span>
          <textarea id="reachCampText" rows="4" maxlength="500" placeholder="要群发的文字，最多 500 字"></textarea>
        </label>
        <div class="reach-f2">
          <label class="field"><span>最小间隔（秒）</span><input id="reachCampMin" type="number" min="5" step="1" value="30"></label>
          <label class="field"><span>最大间隔（秒）</span><input id="reachCampMax" type="number" min="5" step="1" value="90"></label>
        </div>
        <p class="tiny" id="reachCampMeta">已选 0 / 可发 0 / 单日上限 -</p>
        <div class="row">
          <button class="primary" id="reachCampStart" type="submit">开始群发</button>
          <button class="danger" id="reachCampStop" type="button" hidden>停止</button>
          <span class="tiny" id="reachCampMsg"></span>
        </div>
        <p class="hint" id="reachCampHint">服务端会跳过今天已经发过的和超上限的，遇到风控或登录失效会自动停。单日上限、一次最多和间隔由 admin 在「账号与设置」里统一设置。</p>
        <pre class="reach-pre mono" id="reachCampLog" hidden></pre>
      </form>
    </div>
  </div>
</section>

<section class="sec">
  <div class="sec-head">
    <h2>任务</h2>
    <span class="sub">采集任务列表；运行中的可以停止，点「日志」展开这一轮的输出。</span>
    <span class="spacer"></span>
    <button class="ghost sm" id="reachJobsReload" type="button">刷新</button>
  </div>
  <div class="tbl-wrap" id="reachJobsWrap" hidden>
    <table class="tbl">
      <thead><tr>
        <th>平台</th><th>类型</th><th>状态</th><th>创建时间</th><th class="num">条数</th><th></th>
      </tr></thead>
      <tbody id="reachJobsBody"></tbody>
    </table>
  </div>
  <div class="empty" id="reachJobsEmpty" hidden>
    <b>还没有任务</b>
    <span>去采集页提交一次采集，任务进度和日志会出现在这里。</span>
    <div><button class="btn ghost sm" id="reachJobsGoCrawl" type="button">去采集页</button></div>
  </div>
  <p class="hint" id="reachJobsMsg" hidden></p>
</section>

<section class="sec">
  <details class="card reach-det" id="reachInter">
    <summary>单条互动（发评论 / 私信）<span class="sub">从采集页的评论点「回复」会自动填好这里。</span></summary>
    <form id="reachActForm" class="reach-act">
      <label class="field"><span>动作</span>
        <select id="reachActKind">
          <option value="comment">发表评论</option>
          <option value="dm">发私信</option>
        </select>
      </label>
      <label class="field"><span>平台</span><select id="reachActPlatform"></select></label>
      <label class="field"><span id="reachActTargetLabel">作品 ID / 链接</span>
        <input id="reachActTarget" placeholder="评论发到这个作品">
      </label>
      <label class="field" id="reachActReplyField"><span>回复评论 ID（可选）</span>
        <input id="reachActReplyTo" placeholder="要回复的那条评论">
      </label>
      <label class="field full"><span>内容</span>
        <input id="reachActText" maxlength="500" placeholder="要发送的文字，最多 500 字">
      </label>
      <div class="row full">
        <button class="primary" id="reachActSend" type="submit">发送（会二次确认）</button>
        <span class="tiny" id="reachActMsg"></span>
      </div>
    </form>
  </details>
</section>
</div>

<div id="reachPanelChat" role="tabpanel" aria-labelledby="reachTabChat" hidden>
<section class="sec">
  <div class="sec-head">
    <h2>私信会话</h2>
    <span class="sub">左列选会话，右列看记录、直接发；没有历史也能发第一条。「同步历史」目前小红书可用，抖音的消息历史接口还在规划中。</span>
  </div>
  <div class="reach-chat">
    <div class="card reach-threads">
      <div class="row reach-threads-head">
        <b class="tiny">会话</b>
        <span class="spacer"></span>
        <span class="tiny num" id="reachThreadCount"></span>
      </div>
      <div class="reach-thread-list" id="reachThreadList"></div>
      <div class="empty reach-th-empty" id="reachThreadEmpty" hidden></div>
      <p class="hint" id="reachThreadsMsg" hidden></p>
    </div>

    <div class="card reach-chat-main">
      <div class="reach-chat-head">
        <div class="reach-chat-peer">
          <b id="reachChatName">未选择会话</b>
          <span class="tiny" id="reachChatMeta">从左边选一个会话，或回候选池点「打开会话」。</span>
        </div>
        <button class="ghost sm" id="reachChatReload" type="button">刷新</button>
        <button class="ghost sm" id="reachChatSync" type="button" disabled>同步历史</button>
      </div>
      <p class="reach-chat-note" id="reachChatNote" hidden></p>
      <div class="reach-msgs" id="reachChatMsgs">
        <div id="reachChatList"></div>
        <div class="empty reach-msgs-empty" id="reachChatEmpty" hidden></div>
      </div>
      <form class="reach-composer" id="reachChatForm">
        <textarea id="reachChatText" rows="2" maxlength="500" placeholder="先在左边选一个会话" disabled></textarea>
        <div class="reach-comp-bar">
          <span class="tiny num" id="reachChatCount">0 / 500</span>
          <span class="tiny">Enter 发送，Shift+Enter 换行</span>
          <span class="spacer"></span>
          <button class="primary" id="reachChatSend" type="submit" disabled>发送</button>
        </div>
      </form>
    </div>
  </div>
</section>
</div>`,

  js: String.raw`
/* ---------------------------------------------------------------- 状态 */
var reachCands=[],reachCandSel={};
var reachSettings={dailyCap:null,minSeconds:30,maxSeconds:90};
var reachCamp=null;
var reachJobs=[],reachOpenJob=null,reachJobsTimer=null,reachJobsSeq=0;
var reachActMap={comment:[],dm:[]};
var reachTabCur='cand';
var reachThreads=[],reachThreadsSeq=0,reachThreadsLoaded=false;
var reachPeerNames={};
var reachChat={platform:'',peerId:'',peerName:'',messages:[],ghost:null,seq:0,sending:false,syncing:false};

function reachShow(el,text){if(!el)return;if(text){el.textContent=text;el.hidden=false}else{el.textContent='';el.hidden=true}}
function reachShort(v,n){var s=String(v==null?'':v);return s.length>n?s.slice(0,n-1)+'…':s}
function reachParseJson(raw){
  if(raw==null)return null;
  if(typeof raw==='object')return raw;
  try{return JSON.parse(String(raw))}catch(e){return null}
}

/* ---------------------------------------------------------------- 分栏 tab */
function reachSetTab(name){
  var next=name==='chat'?'chat':'cand';
  reachTabCur=next;
  var pairs=[['cand',$('#reachTabCand'),$('#reachPanelCand')],['chat',$('#reachTabChat'),$('#reachPanelChat')]];
  var i,on,btn,panel;
  for(i=0;i<pairs.length;i++){
    on=pairs[i][0]===next;btn=pairs[i][1];panel=pairs[i][2];
    if(btn){
      btn.setAttribute('aria-selected',on?'true':'false');
      btn.className='reach-tab'+(on?' is-on':'');
    }
    if(panel)panel.hidden=!on;
  }
  if(next==='chat'){
    if(!reachThreadsLoaded)reachLoadThreads();
    reachChatHead();
    reachRenderMessages(reachChat.messages);
  }
  var bar=$('#reachTabs');
  if(bar&&bar.getBoundingClientRect&&bar.getBoundingClientRect().top<0&&bar.scrollIntoView)bar.scrollIntoView({block:'start'});
}

function reachCandById(id){
  var i;
  for(i=0;i<reachCands.length;i++){if(reachCands[i].id===id)return reachCands[i]}
  return null;
}

/* ---------------------------------------------------------------- 候选池 */
function reachSelIds(){var out=[],k;for(k in reachCandSel){if(reachCandSel[k])out.push(k)}return out}

function reachUpdateMeta(){
  var typeEl=$('#reachCampType'),type=typeEl?typeEl.value:'reply';
  var pool=0,i;
  for(i=0;i<reachCands.length;i++){if(reachCands[i].type===type)pool++}
  var cap=reachSettings.dailyCap==null?'-':String(reachSettings.dailyCap);
  var el=$('#reachCampMeta');
  if(el)el.textContent='已选 '+reachSelIds().length+' / 可发 '+pool+' / 单日上限 '+cap;
}

function reachCandTarget(c){
  var id=c.type==='reply'?(c.commentId||''):(c.userId||'');
  var who=c.userName?c.userName+' · ':'';
  return who+(c.type==='reply'?'评论 ':'用户 ')+id;
}

function reachRenderCandidates(){
  var body=$('#reachCandBody'),wrap=$('#reachCandWrap'),empty=$('#reachCandEmpty'),sum=$('#reachCandSummary');
  var reply=0,dm=0,i,c;
  for(i=0;i<reachCands.length;i++){if(reachCands[i].type==='dm')dm++;else reply++}
  if(sum)sum.textContent='回复 '+reply+' 条 · 私信 '+dm+' 条';
  if(!reachCands.length){
    if(body)body.innerHTML='';
    if(wrap)wrap.hidden=true;
    if(empty)empty.hidden=false;
    reachUpdateMeta();
    return;
  }
  if(wrap)wrap.hidden=false;
  if(empty)empty.hidden=true;
  var html='';
  for(i=0;i<reachCands.length;i++){
    c=reachCands[i];
    var target=reachCandTarget(c);
    var note=c.note||('作品 '+c.itemId);
    var chatBtn=c.userId
      ?'<button class="ghost sm" type="button" data-chat="'+esc(c.id)+'">打开会话</button>'
      :'<button class="ghost sm" type="button" disabled title="这条候选没有用户 ID（评论作者没采到），打不开会话">打开会话</button>';
    html+='<tr>'+
      '<td class="sel"><input type="checkbox" data-sel="'+esc(c.id)+'"'+(reachCandSel[c.id]?' checked':'')+' aria-label="选择候选"></td>'+
      '<td><span class="badge">'+(c.type==='reply'?'回复':'私信')+'</span></td>'+
      '<td class="mono tiny">'+esc(c.platform)+'</td>'+
      '<td class="tx" title="'+esc(target)+'">'+esc(target)+'</td>'+
      '<td class="tx" title="'+esc(note)+'">'+esc(note)+'</td>'+
      '<td><span class="reach-cand-ops">'+chatBtn+
        '<button class="danger sm" type="button" data-del="'+esc(c.id)+'">移除</button>'+
      '</span></td>'+
    '</tr>';
  }
  if(body)body.innerHTML=html;
  reachBindCandidates();
  reachUpdateMeta();
}

function reachBindCandidates(){
  var body=$('#reachCandBody');
  if(!body)return;
  Array.prototype.forEach.call(body.querySelectorAll('input[data-sel]'),function(box){
    box.onchange=function(){
      if(box.checked)reachCandSel[box.dataset.sel]=1;else delete reachCandSel[box.dataset.sel];
      reachUpdateMeta();
    };
  });
  Array.prototype.forEach.call(body.querySelectorAll('button[data-chat]'),function(btn){
    btn.onclick=function(){
      var c=reachCandById(btn.dataset.chat);
      if(!c)return;
      if(!c.userId){reachShow($('#reachCandMsg'),'这条候选没有用户 ID（评论作者没采到），打不开会话。');return}
      reachShow($('#reachCandMsg'),'');
      reachOpenChat(c.platform,c.userId,c.userName);
    };
  });
  Array.prototype.forEach.call(body.querySelectorAll('button[data-del]'),function(btn){
    btn.onclick=async function(){
      btn.disabled=true;
      try{
        await api('/api/candidates/'+encodeURIComponent(btn.dataset.del),{method:'DELETE'});
        delete reachCandSel[btn.dataset.del];
        toast('已移除候选');
        await reachLoadCandidates();
      }catch(e){
        btn.disabled=false;
        reachShow($('#reachCandMsg'),'移除失败：'+e.message);
      }
    };
  });
}

async function reachLoadCandidates(){
  var msg=$('#reachCandMsg');
  try{
    var r=await api('/api/candidates');
    reachCands=(r&&r.candidates)||[];
    var keep={},i;
    for(i=0;i<reachCands.length;i++){if(reachCandSel[reachCands[i].id])keep[reachCands[i].id]=1}
    reachCandSel=keep;
    reachShow(msg,'');
    reachRenderCandidates();
  }catch(e){
    reachCands=[];reachCandSel={};
    var wrap=$('#reachCandWrap'),empty=$('#reachCandEmpty'),sum=$('#reachCandSummary');
    if(wrap)wrap.hidden=true;
    if(empty)empty.hidden=true;
    if(sum)sum.textContent='';
    reachShow(msg,'候选池读取失败：'+e.message);
    reachUpdateMeta();
  }
}

async function reachRemoveSelected(){
  var ids=reachSelIds(),msg=$('#reachCandMsg');
  if(!ids.length){reachShow(msg,'先勾选要移除的候选。');return}
  if(!confirm('移除选中的 '+ids.length+' 条候选？'))return;
  var btn=$('#reachCandBulk');
  if(btn)btn.disabled=true;
  var ok=0,fail=0,firstError='',i;
  for(i=0;i<ids.length;i++){
    try{
      await api('/api/candidates/'+encodeURIComponent(ids[i]),{method:'DELETE'});
      delete reachCandSel[ids[i]];
      ok++;
    }catch(e){
      fail++;
      if(!firstError)firstError=e.message;
    }
  }
  if(btn)btn.disabled=false;
  await reachLoadCandidates();
  if(fail)reachShow(msg,'移除 '+ok+' 条，失败 '+fail+' 条：'+firstError);
  else{reachShow(msg,'');toast('已移除 '+ok+' 条候选')}
}

async function reachClearCandidates(type){
  if(!confirm(type==='reply'?'清空所有回复候选？':'清空所有私信候选？'))return;
  try{
    var r=await post('/api/candidates/clear',{type:type});
    await reachLoadCandidates();
    toast('已清空 '+(r&&r.removed!=null?r.removed:0)+' 条');
  }catch(e){
    reachShow($('#reachCandMsg'),'清空失败：'+e.message);
  }
}

async function reachLoadSettings(){
  try{
    var s=await api('/api/settings');
    reachSettings={dailyCap:s.dailyCap,minSeconds:s.minSeconds,maxSeconds:s.maxSeconds};
    var mn=$('#reachCampMin'),mx=$('#reachCampMax');
    if(mn)mn.value=s.minSeconds;
    if(mx)mx.value=s.maxSeconds;
    reachUpdateMeta();
  }catch(e){
    reachShow($('#reachCampMsg'),'设置读取失败：'+e.message);
  }
}

/* ---------------------------------------------------------------- 群发 + SSE */
function reachSetCampMsg(text){
  var el=$('#reachCampMsg');
  if(el)el.textContent=text||'';
}

function reachAppendCamp(line){
  var pre=$('#reachCampLog');
  if(!pre)return;
  pre.hidden=false;
  pre.textContent+=line+nl();
  pre.scrollTop=pre.scrollHeight;
}

function reachCampClose(){
  if(reachCamp&&reachCamp.es){try{reachCamp.es.close()}catch(e){}reachCamp.es=null}
}

function reachCampDone(text){
  reachCampClose();
  if($('#reachCampStop'))$('#reachCampStop').hidden=true;
  if($('#reachCampStart'))$('#reachCampStart').disabled=false;
  reachSetCampMsg(text);
  reachLoadCandidates();
  reachLoadThreads();
}

async function reachStartCampaign(ev){
  if(ev&&ev.preventDefault)ev.preventDefault();
  var type=$('#reachCampType').value;
  var text=$('#reachCampText').value.trim();
  var min=Number($('#reachCampMin').value),max=Number($('#reachCampMax').value);
  if(!text){reachSetCampMsg('文案不能为空');$('#reachCampText').focus();return}
  if(text.length>500){reachSetCampMsg('文案最多 500 字，现在 '+text.length+' 字');return}
  if(!isFinite(min)||min<5)min=5;
  if(!isFinite(max)||max<min)max=min;
  var cap=reachSettings.dailyCap==null?'-':String(reachSettings.dailyCap);
  var title=(type==='reply'?'统一回复':'统一私信')+'：间隔 '+min+'-'+max+' 秒，单日上限 '+cap;
  if(!confirm(title+nl()+nl()+text+nl()+nl()+'开始后按顺序一条条发，随时可以停。确认开始？'))return;
  var btn=$('#reachCampStart');
  if(btn)btn.disabled=true;
  reachSetCampMsg('排队中…');
  try{
    var r=await post('/api/campaigns',{type:type,text:text,minSeconds:min,maxSeconds:max});
    reachSettings={dailyCap:r.dailyCap,minSeconds:r.minSeconds,maxSeconds:r.maxSeconds};
    if($('#reachCampMin'))$('#reachCampMin').value=r.minSeconds;
    if($('#reachCampMax'))$('#reachCampMax').value=r.maxSeconds;
    reachUpdateMeta();
    var pre=$('#reachCampLog');
    if(pre){pre.textContent='';pre.hidden=false}
    reachCamp={id:r.id,es:null,done:false,attempts:1};
    if($('#reachCampStop'))$('#reachCampStop').hidden=false;
    var skip=r.skipped||{},bits=[];
    if(skip.sent)bits.push('已发送过 '+skip.sent);
    if(skip.cap)bits.push('超上限 '+skip.cap);
    if(skip.other)bits.push('其他 '+skip.other);
    reachSetCampMsg('排了 '+r.total+' 条（单日上限 '+r.dailyCap+'）'+(bits.length?'，跳过 '+bits.join('、'):'')+'，开始发送…');
    reachWatchCampaign(r.id);
  }catch(e){
    reachSetCampMsg('开始失败：'+e.message);
    if(btn)btn.disabled=false;
  }
}

function reachWatchCampaign(id){
  reachCampClose();
  if(!reachCamp)reachCamp={id:id,es:null,done:false,attempts:1};
  reachCamp.id=id;
  var es=new EventSource('/api/campaigns/'+encodeURIComponent(id)+'/events');
  reachCamp.es=es;
  es.onmessage=function(ev){
    var e=reachParseJson(ev.data);
    if(!e||!reachCamp||reachCamp.id!==id)return;
    reachCamp.attempts=1;
    var t=String(e.time||'').slice(11,19);
    reachAppendCamp((t?t+' ':'')+(e.message!=null?e.message:''));
    if(e.type==='sent'||e.type==='failed'){
      reachSetCampMsg('进行中：第 '+((e.index||0)+1)+' / '+(e.total||0)+' 条');
    }
    if(e.type==='done'){
      reachCamp.done=true;
      reachCampDone('群发结束：'+(e.message||''));
      toast('群发结束');
    }
  };
  es.onerror=function(){
    if(!reachCamp||reachCamp.id!==id||reachCamp.done){reachCampClose();return}
    if(reachCamp.attempts>=3){
      reachCampClose();
      if($('#reachCampStart'))$('#reachCampStart').disabled=false;
      reachSetCampMsg('日志连接断开；群发可能仍在后台进行，稍后刷新看候选池变化。');
      return;
    }
    reachCamp.attempts=(reachCamp.attempts||0)+1;
    reachCampClose();
    var pre=$('#reachCampLog');
    if(pre)pre.textContent='';
    setTimeout(function(){
      if(reachCamp&&reachCamp.id===id&&!reachCamp.done&&!reachCamp.es)reachWatchCampaign(id);
    },2000);
  };
}

async function reachStopCampaign(){
  if(!reachCamp||!reachCamp.id)return;
  var btn=$('#reachCampStop');
  if(btn)btn.disabled=true;
  try{
    await post('/api/campaigns/'+encodeURIComponent(reachCamp.id)+'/stop',{});
    reachAppendCamp('— 已请求停止，当前这条发完就停 —');
    reachSetCampMsg('已请求停止，当前这条发完就停。');
  }catch(e){
    reachSetCampMsg('停止失败：'+e.message);
  }
  if(btn)btn.disabled=false;
}

/* ---------------------------------------------------------------- 任务与日志 */
function reachJobOpt(job,key){var o=job&&job.options;return o&&o[key]!=null?String(o[key]):''}
function reachTypeText(t){
  if(t==='search')return '关键词搜索';
  if(t==='detail')return '指定作品';
  if(t==='creator')return '指定博主';
  return t||'-';
}
function reachJobTime(job){
  var h=(job&&job.history)||[],i;
  for(i=0;i<h.length&&i<5;i++){
    var e=reachParseJson(h[i]);
    if(e&&e.time)return fmtTime(e.time);
  }
  return '-';
}
function reachJobCount(job){
  var c=job&&job.result&&job.result.counts;
  if(!c)return '<span class="muted">—</span>';
  var bits=[];
  if(c.items!=null)bits.push(c.items+' 作品');
  if(c.comments!=null)bits.push(c.comments+' 评论');
  if(!bits.length)return '<span class="muted">—</span>';
  return esc(bits.join(' · '));
}
function reachStatusBadge(status){
  var map={running:['run','运行中'],done:['ok','完成'],error:['err','失败'],stopped:['warn','已停止']};
  var m=map[status]||['',status||'未知'];
  return '<span class="badge '+m[0]+'">'+esc(m[1])+'</span>';
}

function reachRenderJobs(){
  var body=$('#reachJobsBody'),wrap=$('#reachJobsWrap'),empty=$('#reachJobsEmpty');
  if(!reachJobs.length){
    if(body)body.innerHTML='';
    if(wrap)wrap.hidden=true;
    if(empty)empty.hidden=false;
    return;
  }
  if(wrap)wrap.hidden=false;
  if(empty)empty.hidden=true;
  var html='',i,j,open;
  for(i=0;i<reachJobs.length;i++){
    j=reachJobs[i];
    open=reachOpenJob===j.id;
    html+='<tr data-job="'+esc(j.id)+'">'+
      '<td class="mono tiny">'+esc(reachJobOpt(j,'platform')||'-')+'</td>'+
      '<td class="tiny">'+esc(reachTypeText(reachJobOpt(j,'type')))+'</td>'+
      '<td>'+reachStatusBadge(j.status)+'</td>'+
      '<td class="tiny">'+esc(reachJobTime(j))+'</td>'+
      '<td class="num">'+reachJobCount(j)+'</td>'+
      '<td><span class="row">'+
        (j.status==='running'?'<button class="danger sm" type="button" data-jstop="'+esc(j.id)+'">停止</button>':'')+
        '<button class="ghost sm" type="button" data-jlog="'+esc(j.id)+'" aria-expanded="'+(open?'true':'false')+'">'+(open?'收起日志':'日志')+'</button>'+
      '</span></td>'+
    '</tr>';
    if(open)html+='<tr class="reach-logrow"><td colspan="6"><pre class="reach-pre mono" id="reachJobLog" data-for="'+esc(j.id)+'"></pre></td></tr>';
  }
  if(body)body.innerHTML=html;
  reachBindJobs();
  if(reachOpenJob)reachLoadJobLog(reachOpenJob);
}

function reachBindJobs(){
  var body=$('#reachJobsBody');
  if(!body)return;
  Array.prototype.forEach.call(body.querySelectorAll('button[data-jlog]'),function(btn){
    btn.onclick=function(){
      var id=btn.dataset.jlog;
      reachOpenJob=reachOpenJob===id?null:id;
      reachRenderJobs();
    };
  });
  Array.prototype.forEach.call(body.querySelectorAll('button[data-jstop]'),function(btn){
    btn.onclick=function(){reachStopJob(btn.dataset.jstop,btn)};
  });
}

async function reachStopJob(id,btn){
  if(!confirm('停止这个采集任务？已经采到的数据会保留。'))return;
  if(btn)btn.disabled=true;
  try{
    await post('/api/jobs/'+encodeURIComponent(id)+'/stop',{});
    toast('已请求停止');
    setTimeout(reachLoadJobs,600);
  }catch(e){
    if(btn)btn.disabled=false;
    reachShow($('#reachJobsMsg'),'停止失败：'+e.message);
  }
}

function reachEventLines(list){
  var out=[],i,item,e;
  for(i=0;i<list.length;i++){
    item=list[i];
    if(item==null)continue;
    if(typeof item==='string'){
      e=reachParseJson(item);
      if(e&&typeof e==='object')out.push(reachLogLine(e));
      else if(item!=='')out.push(item);
      continue;
    }
    if(typeof item==='object')out.push(reachLogLine(item));
  }
  return out;
}

function reachLogLine(e){
  var t=e.time?String(e.time).slice(11,19):'';
  var text='';
  if(e.message!=null)text=String(e.message);
  else if(e.text!=null)text=String(e.text);
  else if(e.data!=null)text=reachShort(typeof e.data==='string'?e.data:JSON.stringify(e.data),200);
  return (t?t+' ':'')+text;
}

/** 日志接口的返回字段按 ui.ts 为准，同时兼容 lines / log / text / history 几种包装。 */
function reachLogLines(payload){
  if(payload==null)return [];
  if(typeof payload==='string')return payload.split(/\r?\n/);
  if(Array.isArray(payload))return reachEventLines(payload);
  var raw=payload.lines||payload.log||payload.logs||payload.text||payload.content||payload.history||payload.events;
  if(Array.isArray(raw))return reachEventLines(raw);
  if(typeof raw==='string')return raw.split(/\r?\n/);
  if(payload.job)return reachLogLines(payload.job);
  return [];
}

function reachHistoryLines(id){
  var i;
  for(i=0;i<reachJobs.length;i++){
    if(reachJobs[i].id!==id)continue;
    return Array.isArray(reachJobs[i].history)?reachEventLines(reachJobs[i].history):[];
  }
  return [];
}

async function reachLoadJobLog(id){
  var pre=$('#reachJobLog');
  if(!pre||pre.getAttribute('data-for')!==id)return;
  if(!pre.textContent)pre.textContent='读取日志…';
  var lines=null;
  try{
    lines=reachLogLines(await api('/api/jobs/'+encodeURIComponent(id)+'/log'));
  }catch(e){
    lines=null;
  }
  if(!lines||!lines.length){
    lines=reachHistoryLines(id);
    if(!lines.length)lines=['（暂无日志）'];
  }
  if(lines.length>400)lines=lines.slice(-400);
  var target=$('#reachJobLog');
  if(!target||target.getAttribute('data-for')!==id)return;
  target.textContent=lines.join(nl());
  target.scrollTop=target.scrollHeight;
}

function reachHasRunning(){
  var i;
  for(i=0;i<reachJobs.length;i++){if(reachJobs[i].status==='running')return true}
  return false;
}

function reachJobsPollStart(){
  if(reachJobsTimer)return;
  reachJobsTimer=setInterval(function(){reachLoadJobs()},5000);
}

function reachJobsPollStop(){
  if(reachJobsTimer){clearInterval(reachJobsTimer);reachJobsTimer=null}
}

async function reachLoadJobs(){
  var msg=$('#reachJobsMsg');
  var seq=++reachJobsSeq;
  try{
    var list=await api('/api/jobs');
    if(seq!==reachJobsSeq)return;
    reachJobs=Array.isArray(list)?list:[];
    var stillOpen=false,i;
    for(i=0;i<reachJobs.length;i++){if(reachJobs[i].id===reachOpenJob)stillOpen=true}
    if(!stillOpen)reachOpenJob=null;
    reachShow(msg,'');
    reachRenderJobs();
  }catch(e){
    if(seq!==reachJobsSeq)return;
    reachShow(msg,'任务读取失败：'+e.message);
  }
  if(reachHasRunning())reachJobsPollStart();else reachJobsPollStop();
}

/* ---------------------------------------------------------------- 单条互动 */
function reachRenderPlatforms(){
  var kindEl=$('#reachActKind'),sel=$('#reachActPlatform');
  if(!kindEl||!sel)return;
  var kind=kindEl.value,list=reachActMap[kind]||[],html='',i,keep=sel.value;
  for(i=0;i<list.length;i++)html+='<option value="'+esc(list[i])+'">'+esc(list[i])+'</option>';
  if(!html)html='<option value="">（该动作暂无可用平台）</option>';
  sel.innerHTML=html;
  if(keep){
    for(i=0;i<sel.options.length;i++){if(sel.options[i].value===keep){sel.selectedIndex=i;break}}
  }
  if($('#reachActReplyField'))$('#reachActReplyField').hidden=kind!=='comment';
  if($('#reachActTargetLabel'))$('#reachActTargetLabel').textContent=kind==='comment'?'作品 ID / 链接':'对方用户 ID / 主页';
}

async function reachLoadActionPlatforms(){
  try{
    var map=await api('/api/actions/platforms');
    reachActMap={comment:(map&&map.comment)||[],dm:(map&&map.dm)||[]};
    reachRenderPlatforms();
  }catch(e){
    reachShow($('#reachActMsg'),'可选平台读取失败：'+e.message);
  }
}

async function reachSendAction(ev){
  if(ev&&ev.preventDefault)ev.preventDefault();
  var kind=$('#reachActKind').value;
  var platform=$('#reachActPlatform').value;
  var target=$('#reachActTarget').value.trim();
  var text=$('#reachActText').value.trim();
  var replyTo=$('#reachActReplyTo').value.trim();
  var msg=$('#reachActMsg');
  if(!platform){reachShow(msg,'先选平台；没有可选项时先去「账号与设置」登录账号。');return}
  if(!target){reachShow(msg,kind==='comment'?'作品 ID / 链接不能为空':'对方用户 ID 不能为空');return}
  if(!text){reachShow(msg,'内容不能为空');$('#reachActText').focus();return}
  var title=kind==='comment'
    ?'给 '+platform+' 的作品 '+target+' 发评论'+(replyTo?'（回复评论 '+replyTo+'）':'')
    :'用 '+platform+' 给 '+target+' 发私信';
  if(!confirm(title+nl()+nl()+text+nl()+nl()+'确认发送？'))return;
  var btn=$('#reachActSend');
  if(btn)btn.disabled=true;
  reachShow(msg,'发送中…');
  try{
    var r=await post('/api/action',{kind:kind,platform:platform,target:target,text:text,replyTo:replyTo||undefined});
    if(r&&r.ok){reachShow(msg,'已发送');toast('已发送')}
    else reachShow(msg,'发送失败（'+((r&&r.code)||'ERROR')+'）：'+((r&&r.message)||'平台没有返回原因'));
  }catch(e){
    reachShow(msg,'发送失败：'+e.message);
  }
  if(btn)btn.disabled=false;
}

/** 采集页点「回复」→ hook('replyTo')：填好平台/作品/评论并展开这一块。 */
function reachFillReply(input){
  var data=input||{};
  if(typeof data==='string')data={commentId:data};
  var platform=data.platform||data.platformId||'';
  var target=data.target||data.itemId||data.item||'';
  var commentId=data.commentId||data.comment_id||data.replyTo||data.id||'';
  var text=data.text||data.content||'';
  var box=$('#reachInter');
  if(box)box.open=true;
  if($('#reachActKind')){
    $('#reachActKind').value='comment';
    reachRenderPlatforms();
  }
  var sel=$('#reachActPlatform');
  if(platform&&sel){
    var exists=false,i;
    for(i=0;i<sel.options.length;i++){if(sel.options[i].value===platform)exists=true}
    if(!exists)sel.insertAdjacentHTML('beforeend','<option value="'+esc(platform)+'">'+esc(platform)+'</option>');
    sel.value=platform;
  }
  if(target&&$('#reachActTarget'))$('#reachActTarget').value=target;
  if(commentId&&$('#reachActReplyTo'))$('#reachActReplyTo').value=commentId;
  if(text&&$('#reachActText'))$('#reachActText').value=text;
  if($('#reachActText'))$('#reachActText').focus();
  if(box&&box.scrollIntoView)box.scrollIntoView({behavior:'smooth',block:'center'});
  toast('已填入目标，补充文案后确认发送');
}

/* ---------------------------------------------------------------- 私信会话 */
function reachChatNote(text,isErr){
  var el=$('#reachChatNote');
  if(!el)return;
  if(text){el.textContent=text;el.hidden=false;el.className='reach-chat-note'+(isErr?' is-err':'')}
  else{el.textContent='';el.hidden=true;el.className='reach-chat-note'}
}

function reachChatCount(){
  var ta=$('#reachChatText'),el=$('#reachChatCount');
  if(!el)return;
  var n=ta?String(ta.value||'').length:0;
  el.textContent=n+' / 500';
  el.style.color=n>500?'var(--danger)':'';
}

/** 昵称：优先服务端的，其次这次从候选带过来的，最后退回 peerId。 */
function reachPeerLabel(platform,peerId,name){
  if(name)return name;
  return reachPeerNames[platform+':'+peerId]||peerId;
}

/** 顶部：对方昵称 + 平台 + 按钮可用性（没有会话时输入框关掉）。 */
function reachChatHead(){
  var cur=reachChat,has=!!(cur.platform&&cur.peerId);
  var name=$('#reachChatName'),meta=$('#reachChatMeta');
  var ta=$('#reachChatText'),send=$('#reachChatSend'),sync=$('#reachChatSync');
  if(name)name.textContent=has?reachPeerLabel(cur.platform,cur.peerId,cur.peerName):'未选择会话';
  if(meta)meta.textContent=has?(cur.platform+' · '+cur.peerId):'从左边选一个会话，或回候选池点「打开会话」。';
  if(ta){
    ta.disabled=!has||cur.sending;
    ta.placeholder=has?'输入私信内容…':'先在左边选一个会话';
  }
  if(send)send.disabled=!has||cur.sending;
  if(sync)sync.disabled=!has||cur.syncing;
}

/** 会话列表：服务端的会话 + 刚从候选打开、还没有任何记录的那一个。 */
function reachThreadItems(){
  var out=[],i,t,g=reachChat.ghost;
  if(g)out.push(g);
  for(i=0;i<reachThreads.length;i++){
    t=reachThreads[i];
    if(g&&t.platform===g.platform&&t.peerId===g.peerId)continue;
    out.push(t);
  }
  return out;
}

function reachThreadLast(t){
  if(!t||!t.last||t.last.text==null||t.last.text==='')return '还没有消息';
  return (t.last.direction==='out'?'我：':'')+String(t.last.text);
}

function reachRenderThreads(){
  var list=$('#reachThreadList'),empty=$('#reachThreadEmpty'),cnt=$('#reachThreadCount');
  var items=reachThreadItems(),html='',i,t,on,name,local;
  if(cnt)cnt.textContent=items.length?items.length+' 个':'';
  if(!items.length){
    if(list){list.innerHTML='';list.hidden=true}
    if(empty){
      empty.innerHTML='<b>还没有会话</b><span>回「候选与群发」，在候选行点「打开会话」发第一条；发过的私信会按人整理到这里。</span>';
      empty.hidden=false;
    }
    return;
  }
  if(list)list.hidden=false;
  if(empty)empty.hidden=true;
  for(i=0;i<items.length;i++){
    t=items[i];
    on=reachChat.platform===t.platform&&reachChat.peerId===t.peerId;
    name=reachPeerLabel(t.platform,t.peerId,t.peerName);
    local=t.peerName||reachPeerNames[t.platform+':'+t.peerId]||'';
    html+='<button type="button" class="reach-th'+(on?' is-on':'')+'"'+
      ' data-th-platform="'+esc(t.platform)+'" data-th-peer="'+esc(t.peerId)+'" data-th-name="'+esc(local)+'"'+
      ' aria-pressed="'+(on?'true':'false')+'" title="'+esc(name+' · '+t.platform+' · '+t.peerId)+'">'+
      '<span class="reach-th-top"><span class="reach-th-name">'+esc(name)+'</span><span class="badge">'+esc(t.platform)+'</span></span>'+
      '<span class="reach-th-last">'+esc(reachThreadLast(t))+'</span>'+
      '<span class="reach-th-meta"><span>'+esc(t.last?fmtTime(t.last.at):'')+'</span><span class="num">'+Number(t.count||0)+' 条</span></span>'+
    '</button>';
  }
  if(list)list.innerHTML=html;
}

function reachMarkThread(){
  var list=$('#reachThreadList');
  if(!list)return;
  Array.prototype.forEach.call(list.querySelectorAll('button[data-th-peer]'),function(btn){
    var on=btn.getAttribute('data-th-platform')===reachChat.platform&&btn.getAttribute('data-th-peer')===reachChat.peerId;
    if(on)btn.classList.add('is-on');else btn.classList.remove('is-on');
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
}

async function reachLoadThreads(){
  var msg=$('#reachThreadsMsg'),seq=++reachThreadsSeq;
  try{
    var r=await api('/api/chat/threads');
    if(seq!==reachThreadsSeq)return;
    reachThreads=(r&&r.threads)||[];
    reachThreadsLoaded=true;
    var g=reachChat.ghost,i;
    if(g){
      for(i=0;i<reachThreads.length;i++){
        if(reachThreads[i].platform!==g.platform||reachThreads[i].peerId!==g.peerId)continue;
        if(!reachChat.peerName)reachChat.peerName=reachThreads[i].peerName||'';
        reachChat.ghost=null;
        break;
      }
    }
    reachShow(msg,'');
    reachRenderThreads();
    reachChatHead();
  }catch(e){
    if(seq!==reachThreadsSeq)return;
    reachShow(msg,'会话列表读取失败：'+e.message);
    reachRenderThreads();
  }
}

function reachBubble(m){
  var out=!!(m&&m.direction==='out');
  var fail=out&&m&&m.status==='failed';
  var t=m&&m.at?fmtTime(m.at):'';
  return '<div class="reach-msg '+(out?'is-out':'is-in')+'">'+
    '<div class="reach-bub'+(fail?' is-fail':'')+'">'+
      '<div class="reach-bub-text">'+esc(m&&m.text)+'</div>'+
      '<div class="reach-bub-meta"><span>'+esc(t)+'</span>'+(fail?'<span class="reach-bub-fail">发送失败</span>':'')+'</div>'+
    '</div>'+
  '</div>';
}

function reachRenderMessages(list){
  var wrap=$('#reachChatList'),empty=$('#reachChatEmpty'),box=$('#reachChatMsgs');
  var cur=reachChat,has=!!(cur.platform&&cur.peerId),msgs=Array.isArray(list)?list:[],html='',i;
  cur.messages=msgs;
  for(i=0;i<msgs.length;i++)html+=reachBubble(msgs[i]);
  if(wrap){wrap.innerHTML=html;wrap.hidden=!msgs.length}
  if(empty){
    if(!has){
      empty.innerHTML='<b>还没有打开会话</b><span>从左边选一个会话；或回「候选与群发」，在候选行点「打开会话」，没有历史也能直接发。</span>';
      empty.hidden=false;
    }else if(!msgs.length){
      empty.innerHTML='<b>还没有消息</b><span>在下面输入框发第一条；也可以点「同步历史」把平台上的聊天记录拉过来。</span>';
      empty.hidden=false;
    }else empty.hidden=true;
  }
  if(box&&msgs.length)box.scrollTop=box.scrollHeight;
}

function reachChatLoading(){
  var wrap=$('#reachChatList'),empty=$('#reachChatEmpty');
  if(wrap){wrap.innerHTML='<p class="loading">读取消息…</p>';wrap.hidden=false}
  if(empty)empty.hidden=true;
}

async function reachChatLoadMessages(){
  var cur=reachChat;
  if(!cur.platform||!cur.peerId){reachRenderMessages([]);return}
  var platform=cur.platform,peerId=cur.peerId,seq=++cur.seq;
  try{
    var r=await api('/api/chat/messages?platform='+encodeURIComponent(platform)+'&peerId='+encodeURIComponent(peerId));
    if(seq!==reachChat.seq||reachChat.platform!==platform||reachChat.peerId!==peerId)return;
    reachRenderMessages((r&&r.messages)||[]);
  }catch(e){
    if(seq!==reachChat.seq||reachChat.platform!==platform||reachChat.peerId!==peerId)return;
    reachRenderMessages([]);
    var empty=$('#reachChatEmpty');
    if(empty){
      empty.innerHTML='<b>消息读取失败</b><span>'+esc(e.message)+'</span><div><button class="btn ghost sm" type="button" id="reachChatRetry">重试</button></div>';
      empty.hidden=false;
    }
    var retry=$('#reachChatRetry');
    if(retry)retry.onclick=function(){reachChatLoadMessages()};
  }
}

/** 打开会话：有记录就拉消息；没有记录也照样能发（列表里先挂一个「还没有消息」的条目）。 */
async function reachOpenChat(platform,peerId,peerName){
  if(!platform||!peerId){toast('缺平台或用户 ID，打不开会话','err');return}
  var cur=reachChat,hit=null,i;
  cur.platform=platform;
  cur.peerId=peerId;
  cur.peerName=peerName||'';
  cur.messages=[];
  cur.ghost=null;
  if(peerName)reachPeerNames[platform+':'+peerId]=peerName;
  for(i=0;i<reachThreads.length;i++){
    if(reachThreads[i].platform!==platform||reachThreads[i].peerId!==peerId)continue;
    hit=reachThreads[i];
    break;
  }
  if(hit&&!cur.peerName)cur.peerName=hit.peerName||reachPeerNames[platform+':'+peerId]||'';
  if(!hit)cur.ghost={platform:platform,peerId:peerId,peerName:peerName||null,count:0,last:null};
  reachSetTab('chat');
  reachRenderThreads();
  reachMarkThread();
  reachChatHead();
  reachChatNote('');
  reachChatLoading();
  await reachChatLoadMessages();
  if($('#reachChatText'))$('#reachChatText').focus();
}

async function reachChatSend(ev){
  if(ev&&ev.preventDefault)ev.preventDefault();
  var cur=reachChat;
  if(cur.sending)return;
  if(!cur.platform||!cur.peerId){reachChatNote('先选一个会话：左边列表，或回候选池点「打开会话」。',true);return}
  var ta=$('#reachChatText'),btn=$('#reachChatSend');
  var text=ta?String(ta.value||'').trim():'';
  if(!text){reachChatNote('内容不能为空',true);if(ta)ta.focus();return}
  if(text.length>500){reachChatNote('最多 500 字，现在 '+text.length+' 字',true);return}
  var platform=cur.platform,peerId=cur.peerId,peerName=cur.peerName;
  var same=function(){return reachChat.platform===platform&&reachChat.peerId===peerId};
  cur.sending=true;
  if(btn){btn.disabled=true;btn.textContent='发送中…'}
  if(ta)ta.disabled=true;
  reachChatNote('');
  try{
    await post('/api/chat/send',{platform:platform,peerId:peerId,peerName:peerName||undefined,text:text});
    if(same()){
      if(ta)ta.value='';
      reachChatCount();
    }
    reachChatNote('已发送。同一账号 3 秒内不能连发，下一条稍等。');
    toast('已发送');
    if(same())await reachChatLoadMessages();
    reachLoadThreads();
  }catch(e){
    reachChatNote('发送失败：'+e.message,true);
    /* 失败的那条服务端也会记下来，重新拉一次就能看到红色「发送失败」气泡。 */
    if(same())await reachChatLoadMessages();
    reachLoadThreads();
  }finally{
    cur.sending=false;
    if(btn)btn.textContent='发送';
    if(ta)ta.disabled=false;
    reachChatHead();
    if(ta)ta.focus();
  }
}

async function reachChatSync(){
  var cur=reachChat;
  if(cur.syncing)return;
  if(!cur.platform||!cur.peerId){reachChatNote('先在左边选一个会话，再同步历史。',true);return}
  var platform=cur.platform,peerId=cur.peerId,peerName=cur.peerName;
  var btn=$('#reachChatSync');
  cur.syncing=true;
  if(btn){btn.disabled=true;btn.textContent='同步中…'}
  reachChatNote('');
  try{
    var r=await post('/api/chat/sync',{platform:platform,peerId:peerId,peerName:peerName||undefined});
    var imported=Number((r&&r.imported)||0);
    var same=reachChat.platform===platform&&reachChat.peerId===peerId;
    if(same&&r&&Array.isArray(r.messages))reachRenderMessages(r.messages);
    else if(same)await reachChatLoadMessages();
    reachChatNote(imported?'已同步 '+imported+' 条新消息。':'没有新消息，平台返回的历史都已经在了。',false);
    reachLoadThreads();
  }catch(e){
    reachChatNote('同步历史失败：'+e.message,true);
  }finally{
    cur.syncing=false;
    if(btn)btn.textContent='同步历史';
    reachChatHead();
  }
}

async function reachChatRefresh(){
  var btn=$('#reachChatReload');
  if(btn)btn.disabled=true;
  reachChatNote('');
  await reachLoadThreads();
  if(reachChat.platform&&reachChat.peerId)await reachChatLoadMessages();
  if(btn)btn.disabled=false;
}

/* ---------------------------------------------------------------- 绑定与注册 */
$('#reachCampForm').onsubmit=reachStartCampaign;
$('#reachCampStop').onclick=reachStopCampaign;
$('#reachCampType').onchange=reachUpdateMeta;
$('#reachCandBulk').onclick=reachRemoveSelected;
$('#reachClearReply').onclick=function(){reachClearCandidates('reply')};
$('#reachClearDm').onclick=function(){reachClearCandidates('dm')};
$('#reachGoCrawl').onclick=function(){omc.go('crawl')};
$('#reachJobsGoCrawl').onclick=function(){omc.go('crawl')};
$('#reachJobsReload').onclick=function(){reachLoadJobs()};
$('#reachActKind').onchange=reachRenderPlatforms;
$('#reachActForm').onsubmit=reachSendAction;
$('#reachCandAll').onchange=function(){
  var on=this.checked;
  Array.prototype.forEach.call($$('#reachCandBody input[data-sel]'),function(box){
    if(on)reachCandSel[box.dataset.sel]=1;else delete reachCandSel[box.dataset.sel];
    box.checked=on;
  });
  reachUpdateMeta();
};

$$('.reach-tab').forEach(function(btn){
  btn.onclick=function(){reachSetTab(btn.getAttribute('data-reach-tab'))};
});
if($('#reachTabs'))$('#reachTabs').onkeydown=function(ev){
  if(ev.key!=='ArrowLeft'&&ev.key!=='ArrowRight')return;
  ev.preventDefault();
  var next=reachTabCur==='chat'?'cand':'chat';
  reachSetTab(next);
  var btn=next==='chat'?$('#reachTabChat'):$('#reachTabCand');
  if(btn)btn.focus();
};

if($('#reachThreadList'))$('#reachThreadList').onclick=function(ev){
  var el=ev.target;
  while(el&&el.nodeType===1&&el!==this){
    if(el.getAttribute&&el.getAttribute('data-th-peer')){
      reachOpenChat(el.getAttribute('data-th-platform'),el.getAttribute('data-th-peer'),el.getAttribute('data-th-name'));
      return;
    }
    el=el.parentNode;
  }
};
$('#reachChatReload').onclick=reachChatRefresh;
$('#reachChatSync').onclick=reachChatSync;
$('#reachChatForm').onsubmit=reachChatSend;
$('#reachChatText').oninput=reachChatCount;
$('#reachChatText').onkeydown=function(ev){
  if(ev.key!=='Enter'||ev.shiftKey||ev.isComposing||ev.keyCode===229)return;
  ev.preventDefault();
  reachChatSend();
};

/* 从别的页切回触达时也刷新一次（首次进入由 onShow 负责，避免重复请求）。 */
document.addEventListener('click',function(ev){
  var el=ev.target;
  while(el&&el.nodeType===1){
    if(el.getAttribute&&el.getAttribute('data-go')==='reach'){
      if(omc.shown.reach)setTimeout(function(){
        reachLoadCandidates();
        reachLoadJobs();
        reachLoadSettings();
        if(reachTabCur==='chat')reachLoadThreads();
      },0);
      return;
    }
    el=el.parentNode;
  }
});

omc.hook('refreshCandidates',reachLoadCandidates);
omc.hook('refreshJobs',reachLoadJobs);
omc.hook('replyTo',function(x){reachFillReply(x)});
omc.hook('openChat',function(x){if(x&&x.platform&&x.peerId)reachOpenChat(x.platform,x.peerId,x.peerName)});

omc.onShow('reach',function(){
  reachLoadActionPlatforms();
  reachLoadSettings();
  reachLoadCandidates();
  reachLoadJobs();
  if(reachTabCur==='chat')reachLoadThreads();
});
`,
}
