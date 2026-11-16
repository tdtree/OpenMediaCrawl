import type { View } from '../types.js'

/**
 * 账号与设置：平台登录（扫码 / Cookie）、账号切换、登录态检查、发送参数、
 * 派生数据清理、词库管理（防抖自动保存）、用户管理、改自己的密码，
 * 词库维护与用户管理（仅 admin）。
 */

const HTML = String.raw`
<section class="sec">
  <div class="sec-head"><h2>平台与登录</h2><span class="sub">登录态只存在你自己的数据目录里，按平台隔离；同一平台可以存多个账号，随时切换。</span></div>
  <div class="grid2">
    <div class="card">
      <label class="field"><span>平台</span><select id="accountPlatform"></select></label>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="accountScanBtn" type="button">扫码登录</button>
        <button class="ghost" id="accountHealthBtn" type="button">检查登录态</button>
      </div>
      <p class="tiny" id="accountHealthMsg" style="margin-top:8px" role="status" aria-live="polite">还没检查过登录态。</p>
      <details class="account-cookie" id="accountCookieBox">
        <summary class="btn ghost">粘贴 Cookie</summary>
        <label class="field" style="margin-top:8px"><span>Cookie</span>
          <textarea id="accountCookie" rows="3" placeholder="name=value; name2=value2…"></textarea>
        </label>
        <div class="row" style="margin-top:8px">
          <button class="ghost" id="accountCookieBtn" type="button">用 Cookie 登录</button>
          <span class="tiny" id="accountCookieMsg" role="status" aria-live="polite"></span>
        </div>
      </details>
      <div class="account-qr" id="accountQrBox" hidden>
        <img id="accountQrImg" alt="登录二维码" width="220" height="220" loading="lazy">
        <p class="tiny" id="accountQrMsg" role="status" aria-live="polite">请用 App 扫码</p>
      </div>
      <p class="hint" id="accountAccMsg" role="status" aria-live="polite">登录态只存在你自己的数据目录里。</p>
    </div>
    <div class="card">
      <div class="row"><h3>账号</h3><span class="spacer"></span><span class="tiny" id="accountListMsg" role="status" aria-live="polite"></span></div>
      <div class="tbl-wrap" style="margin-top:8px">
        <table class="tbl account-tbl">
          <thead><tr><th>账号</th><th>登录方式</th><th>状态</th><th>操作</th></tr></thead>
          <tbody id="accountList"></tbody>
        </table>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="sec-head"><h2>发送参数与数据</h2><span class="sub">群发默认按这里的间隔和上限执行；上限只影响本地，平台侧仍可能更严。</span></div>
  <div class="grid2">
    <form class="card" id="accountSetForm">
      <h3>群发参数 <span class="tiny" id="accountSetScope">（admin 统一设置，所有账号共用）</span></h3>
      <div class="grid2" style="margin-top:10px">
        <label class="field"><span>单日上限</span><input id="accountCap" type="number" min="1" max="200" step="1"></label>
        <label class="field"><span>一次最多（条）</span><input id="accountBatch" type="number" min="1" max="200" step="1"></label>
        <label class="field"><span>最小间隔（秒）</span><input id="accountMin" type="number" min="5" step="1"></label>
        <label class="field"><span>最大间隔（秒）</span><input id="accountMax" type="number" min="5" step="1"></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="accountSetSave" type="submit">保存</button>
        <span class="tiny" id="accountSetMsg" role="status" aria-live="polite"></span>
      </div>
      <p class="hint" id="accountSetHint">单日上限与一次最多 1-200；间隔最小 5 秒，最大间隔不能小于最小间隔。非 admin 只能查看。</p>
    </form>
    <div class="card account-danger">
      <h3>危险区</h3>
      <p class="sub" style="margin-top:6px">清空派生数据：只删线索、发送记录、候选池和断点状态，不动原始采集文件。</p>
      <label class="field" style="margin-top:10px"><span>确认清空</span><input id="accountClearConfirm" placeholder="输入：确认清空"></label>
      <div class="row" style="margin-top:10px">
        <button class="danger" id="accountClearBtn" type="button">清空派生数据</button>
        <span class="tiny" id="accountClearMsg" role="status" aria-live="polite"></span>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="sec-head"><h2>词库管理</h2><span class="sub">采集页的关键词/评论筛选可以直接从词库导入；改动后 0.6 秒自动保存。</span></div>
  <div class="grid2">
    <div class="card account-lex">
      <div class="row"><h3>搜索关键词库</h3><span class="spacer"></span><span class="tiny account-lex-msg" id="accountLexKwMsg" role="status" aria-live="polite"></span><span class="badge" id="accountLexKwCount">0 个</span></div>
      <div class="chips" id="accountLexKwChips"><span class="tiny">读取中…</span></div>
      <div class="row account-lex-add">
        <input id="accountLexKwInput" autocomplete="off" placeholder="回车添加，可一次粘贴多个词…">
        <button class="ghost sm" id="accountLexKwAdd" type="button">添加</button>
      </div>
      <div class="account-lex-bulk">
        <label class="field"><span>一键导入</span>
          <textarea id="accountLexKwBulk" rows="2" placeholder="一次粘贴多个词，空格 / 斜杠 / 逗号 / 顿号 / 分号都能分开…"></textarea>
        </label>
        <div class="row account-lex-foot">
          <button class="ghost sm" id="accountLexKwImport" type="button">导入</button>
          <span class="tiny" id="accountLexKwNote">最多 300 个，单个词最多 40 字。</span>
        </div>
      </div>
    </div>
    <div class="card account-lex">
      <div class="row"><h3>评论筛选词库</h3><span class="spacer"></span><span class="tiny account-lex-msg" id="accountLexFlMsg" role="status" aria-live="polite"></span><span class="badge" id="accountLexFlCount">0 个</span></div>
      <div class="chips" id="accountLexFlChips"><span class="tiny">读取中…</span></div>
      <div class="row account-lex-add">
        <input id="accountLexFlInput" autocomplete="off" placeholder="回车添加，如 广告 / 引流 / 加微…">
        <button class="ghost sm" id="accountLexFlAdd" type="button">添加</button>
      </div>
      <div class="account-lex-bulk">
        <label class="field"><span>一键导入</span>
          <textarea id="accountLexFlBulk" rows="2" placeholder="一次粘贴多个词，空格 / 斜杠 / 逗号 / 顿号 / 分号都能分开…"></textarea>
        </label>
        <div class="row account-lex-foot">
          <button class="ghost sm" id="accountLexFlImport" type="button">导入</button>
          <span class="tiny" id="accountLexFlNote">最多 300 个，单个词最多 40 字。</span>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="sec-head"><h2>用户</h2><span class="sub">每个用户有独立的数据目录和独立登录态，互不可见。</span></div>
  <div class="card" id="accountUsersCard" hidden>
    <div class="row"><h3>用户管理</h3><span class="spacer"></span><span class="tiny" id="accountUsersMsg" role="status" aria-live="polite"></span></div>
    <div class="tbl-wrap" style="margin-top:8px">
      <table class="tbl account-tbl">
        <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
        <tbody id="accountUserList"></tbody>
      </table>
    </div>
    <div class="row" id="accountPwReset" hidden style="margin-top:12px;align-items:flex-end">
      <label class="field" style="flex:1;min-width:200px"><span>给 <b id="accountPwResetName">-</b> 设置新密码</span><input id="accountPwResetInput" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 位…"></label>
      <button class="primary" id="accountPwResetSave" type="button">保存</button>
      <button class="ghost" id="accountPwResetCancel" type="button">取消</button>
      <span class="tiny" id="accountPwResetMsg" role="status" aria-live="polite"></span>
    </div>
    <form id="accountNewUser" class="grid3" style="margin-top:12px">
      <label class="field"><span>用户名</span><input name="username" autocomplete="off" spellcheck="false" placeholder="小写字母数字 - _…"></label>
      <label class="field"><span>密码</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 位…"></label>
      <label class="field"><span>角色</span><select name="role"><option value="user">user</option><option value="admin">admin</option></select></label>
      <div class="row" style="grid-column:1/-1">
        <button class="primary" id="accountNewUserBtn" type="submit">新建用户</button>
        <span class="tiny" id="accountNewUserMsg" role="status" aria-live="polite"></span>
      </div>
    </form>
  </div>
  <div class="card" id="accountSelfCard" style="margin-top:12px">
    <div class="row"><h3>我的账号</h3><span class="spacer"></span><span class="tiny">当前用户 <b id="accountMeName">-</b></span></div>
    <form id="accountPwSelf" style="margin-top:10px">
      <div class="row" style="align-items:flex-end">
        <label class="field" style="flex:1;min-width:200px"><span>新密码</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 位…"></label>
        <button class="ghost" id="accountPwSelfBtn" type="submit">保存新密码</button>
      </div>
      <p class="tiny" id="accountPwSelfMsg" style="margin-top:8px" role="status" aria-live="polite">改完要重新登录，其他设备上的会话也会失效。</p>
    </form>
  </div>
</section>

`

const CSS = String.raw`
.account-qr{margin-top:var(--s3);padding:var(--s3);border:1px solid var(--line);border-radius:8px;text-align:center}
.account-qr img{width:100%;max-width:220px;height:auto;display:block;margin:0 auto;image-rendering:pixelated;border-radius:6px;background:var(--card)}
.account-qr p{margin-top:var(--s2)}
.account-cookie{margin-top:var(--s3);padding-top:var(--s3);border-top:1px solid var(--line)}
.account-cookie>summary{list-style:none;cursor:pointer}
.account-cookie>summary::-webkit-details-marker{display:none}
.account-cookie>summary::marker{content:""}
.account-danger{border-color:var(--danger)}
.account-tbl td{vertical-align:middle}
.account-tbl td .row{flex-wrap:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start;margin-top:var(--s3);min-height:32px}
.chips .chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;font-size:var(--fs-xs);padding:1px 3px 1px 7px;border:1px solid var(--line);border-radius:3px;background:var(--row-hover);color:var(--fg);word-break:break-all}
.chips .chip-x{appearance:none;border:0;background:none;color:var(--muted);font:inherit;font-size:var(--fs-sm);line-height:1;min-height:0;padding:0 4px;border-radius:2px;cursor:pointer}
.chips .chip-x:hover{background:var(--danger-soft);color:var(--danger)}
.account-lex-add{margin-top:var(--s3);flex-wrap:nowrap}
.account-lex-add input{flex:1;min-width:0}
.account-lex-add button{flex:none}
.account-lex-bulk{margin-top:var(--s3);padding-top:var(--s3);border-top:1px dashed var(--line)}
.account-lex-foot{margin-top:var(--s2)}
.account-lex-msg{font-variant-numeric:tabular-nums}
.account-lex-err{color:var(--danger)}
.account-usage-io{font-variant-numeric:tabular-nums}
.account-usage-io .tiny{font-variant-numeric:tabular-nums;margin-top:1px}
`

const JS = String.raw`
/* ---------------------------------------------------------------- 账号与设置 */
var accountQrTimer=null,accountLoginId=null,accountLoginMethod='qrcode',accountQrStamp=0,accountTickBusy=false,accountPwUser=null;

/** 按钮禁用态 + 加载文案（异步操作统一走这里，结束后恢复原文案）。 */
function accountBtn(btn,busy,label){
  if(!btn)return;
  if(busy){
    if(!btn.dataset.label)btn.dataset.label=btn.textContent;
    btn.disabled=true;
    if(label)btn.textContent=label;
  }else{
    btn.disabled=false;
    if(btn.dataset.label){btn.textContent=btn.dataset.label;delete btn.dataset.label}
  }
}

function accountStopPoll(){if(accountQrTimer){clearInterval(accountQrTimer);accountQrTimer=null}}
function accountQrShow(msg){
  var box=$('#accountQrBox');if(!box)return;
  box.hidden=false;
  if(msg!=null)$('#accountQrMsg').textContent=msg;
}
function accountQrHide(){var box=$('#accountQrBox');if(box)box.hidden=true}
function accountQrReset(){accountQrStamp=0;$('#accountQrImg').removeAttribute('src')}

/** 一次轮询：换码、剩余秒数、成功 / 失败都只写自己这块区域。 */
async function accountPollOnce(id){
  if(accountTickBusy)return;
  accountTickBusy=true;
  try{
    var s=await api('/api/login/'+encodeURIComponent(id));
    if(id!==accountLoginId)return;
    if(s.qr&&s.qr!==accountQrStamp){
      accountQrStamp=s.qr;
      var img=$('#accountQrImg');
      img.hidden=false;
      img.src='/api/qrcode?login='+encodeURIComponent(id)+'&t='+s.qr;
    }
    if(s.status==='pending'){
      accountQrShow();
      var left=s.left!=null?('（剩 '+s.left+' 秒）'):'';
      if(accountLoginMethod==='cookie'&&!s.qr){
        $('#accountQrMsg').textContent='正在校验 Cookie'+left;
      }else{
        $('#accountQrMsg').textContent=(s.message||'等待二维码')+(s.qr?left:'');
      }
      return;
    }
    accountStopPoll();
    accountLoginId=null;
    if(s.status==='ok'){
      accountQrHide();
      $('#accountAccMsg').textContent='登录成功，账号已加入列表。';
      var cookieBox=$('#accountCookieBox');
      if(cookieBox)cookieBox.open=false;
      toast('登录成功，账号已加入列表');
      accountLoadAccounts();
    }else{
      accountQrShow();
      var reason=s.message||'没有拿到原因，重新点扫码再试';
      $('#accountQrMsg').textContent='登录失败：'+reason;
      $('#accountAccMsg').textContent='登录失败：'+reason;
    }
  }catch(e){
    if(id!==accountLoginId)return;
    accountStopPoll();
    accountLoginId=null;
    accountQrShow();
    var msg=e.status===404?'登录任务丢了（服务重启过），重新点扫码':'登录状态读不到：'+e.message;
    $('#accountQrMsg').textContent=msg;
    $('#accountAccMsg').textContent=msg;
  }finally{accountTickBusy=false}
}

/** 开始轮询（resume=true 表示离开页面后回来续上，不重置二维码）。 */
function accountWatch(id,resume){
  accountStopPoll();
  accountLoginId=id;
  if(!resume)accountQrReset();
  var img=$('#accountQrImg');
  img.hidden=accountLoginMethod!=='qrcode';
  accountQrShow(resume?'继续等待扫码…':(accountLoginMethod==='cookie'?'正在校验 Cookie…':'等待二维码…'));
  accountQrTimer=setInterval(function(){accountPollOnce(id)},1500);
  accountPollOnce(id);
}

async function accountStartLogin(payload,btn){
  accountStopPoll();
  accountLoginId=null;
  accountLoginMethod=payload.method==='cookie'?'cookie':'qrcode';
  accountQrReset();
  $('#accountAccMsg').textContent='';
  accountQrShow(accountLoginMethod==='cookie'?'正在用 Cookie 登录…':'正在启动登录…');
  accountBtn(btn,true,'启动中…');
  try{
    var r=await post('/api/login/start',payload);
    accountWatch(r.id,false);
    if(r.reused)$('#accountAccMsg').textContent='这个平台已经有一个进行中的登录，继续用这一次的二维码。';
  }catch(e){
    accountStopPoll();
    accountLoginId=null;
    accountQrReset();
    accountQrShow(e.message);
    $('#accountAccMsg').textContent=e.message;
  }finally{accountBtn(btn,false)}
}

/* ---------------------------------------------------------------- ① 平台 / 账号 */
async function accountLoadPlatforms(){
  var sel=$('#accountPlatform');if(!sel)return;
  var keep=sel.value;
  try{
    var list=await api('/api/platforms');
    list=list||[];
    omc.state.platforms=list;
    if(!list.length){
      sel.innerHTML='';
      sel.disabled=true;
      $('#accountAccMsg').textContent='没有支持登录的平台（服务端没声明 auth login）。';
      return;
    }
    sel.disabled=false;
    sel.innerHTML=list.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>'}).join('');
    if(keep&&list.some(function(p){return p.id===keep}))sel.value=keep;
  }catch(e){
    $('#accountAccMsg').textContent='平台列表读取失败：'+e.message;
  }
}

async function accountLoadAccounts(){
  var tb=$('#accountList');if(!tb)return;
  var p=$('#accountPlatform').value;
  if(!p){
    tb.dataset.loaded='';
    tb.innerHTML='<tr><td colspan="4"><p class="empty">还没有可选平台</p></td></tr>';
    $('#accountListMsg').textContent='';
    return;
  }
  if(!tb.dataset.loaded)tb.innerHTML='<tr><td colspan="4"><p class="loading">读取中…</p></td></tr>';
  try{
    var r=await api('/api/accounts?platform='+encodeURIComponent(p));
    var list=r.accounts||[];
    if(!list.length){
      tb.innerHTML='<tr><td colspan="4"><div class="empty"><b>这个平台还没有登录账号</b>点上面的「扫码登录」或用 Cookie 登录。</div></td></tr>';
      tb.dataset.loaded='1';
      $('#accountListMsg').textContent='共 0 个账号';
      return;
    }
    tb.innerHTML=list.map(function(a){
      var who=a.user&&(a.user.name||a.user.id)?(a.user.name||a.user.id):a.account;
      var raw=a.account&&a.account!==who?'<div class="tiny mono">'+esc(a.account)+'</div>':'';
      return '<tr>'+
        '<td data-label="账号"><div>'+esc(who)+'</div>'+raw+'</td>'+
        '<td data-label="登录方式">'+(a.method?'<span class="badge">'+esc(a.method)+'</span>':'<span class="tiny">-</span>')+'</td>'+
        '<td data-label="状态">'+(a.current?'<span class="badge ok">当前</span>':'<span class="badge">备选</span>')+'</td>'+
        '<td data-label="操作">'+(a.current?'<span class="tiny">使用中</span>':'<button class="sm" type="button" data-account-use="'+esc(a.account)+'">切换为当前</button>')+'</td>'+
        '</tr>';
    }).join('');
    tb.dataset.loaded='1';
    var current=list.filter(function(a){return a.current})[0];
    $('#accountListMsg').textContent='共 '+list.length+' 个账号'+(current?('，当前 '+(current.user&&current.user.name?current.user.name:current.account)):'');
    $$('button[data-account-use]',tb).forEach(function(b){b.onclick=function(){accountUse(b)}});
  }catch(e){
    $('#accountAccMsg').textContent='账号列表读取失败：'+e.message;
    if(!tb.dataset.loaded)tb.innerHTML='<tr><td colspan="4"><p class="empty">'+esc(e.message)+'</p></td></tr>';
  }
}

async function accountUse(btn){
  var platform=$('#accountPlatform').value;
  var account=btn.dataset.accountUse;
  accountBtn(btn,true,'切换中…');
  $('#accountAccMsg').textContent='正在切换到 '+account+'…';
  try{
    await post('/api/accounts/use',{platform:platform,account:account});
    $('#accountAccMsg').textContent='已切换到 '+account+'。';
    await accountLoadAccounts();
  }catch(e){
    $('#accountAccMsg').textContent=e.message;
  }finally{accountBtn(btn,false)}
}

async function accountHealth(btn){
  var p=$('#accountPlatform').value;
  if(!p){$('#accountHealthMsg').textContent='先选平台';return}
  accountBtn(btn,true,'检查中…');
  $('#accountHealthMsg').textContent='检查中…';
  try{
    var h=await api('/api/accounts/health?platform='+encodeURIComponent(p));
    $('#accountHealthMsg').textContent=h.logged_in
      ?('已登录'+(h.user?('：'+h.user):'')+(h.method?('（'+h.method+'）'):''))
      :('未登录/登录已失效'+(h.message?('：'+h.message):''));
  }catch(e){
    /* 检查失败只写这条提示，账号表原样保留 */
    $('#accountHealthMsg').textContent='检查失败：'+e.message;
  }finally{accountBtn(btn,false)}
}

/* ---------------------------------------------------------------- ② 发送参数 / 清空 */
/* 群发参数只有 admin 能改，其他人只读。 */
function accountApplySettingsScope(isAdmin){
  ['#accountCap','#accountBatch','#accountMin','#accountMax'].forEach(function(sel){var el=$(sel);if(el)el.disabled=!isAdmin});
  var btn=$('#accountSetSave');if(btn)btn.hidden=!isAdmin;
  var hint=$('#accountSetHint');if(hint)hint.textContent=isAdmin?'单日上限与一次最多 1-200；间隔最小 5 秒，最大间隔不能小于最小间隔。改完对所有账号生效。':'群发参数由 admin 在「账号与设置」或「用户管理」里统一设置，这里只能查看。';
}

async function accountLoadSettings(){
  try{
    var s=await api('/api/settings');
    $('#accountCap').value=s.dailyCap;
    if($('#accountBatch'))$('#accountBatch').value=s.batchMax;
    $('#accountMin').value=s.minSeconds;
    $('#accountMax').value=s.maxSeconds;
    accountApplySettingsScope(!!(omc.state.me&&omc.state.me.role==='admin'));
  }catch(e){
    $('#accountSetMsg').textContent='读取失败：'+e.message;
  }
}

/* ---------------------------------------------------------------- ③ 词库（防抖自动保存） */
var accountLexMax=300,accountLexMaxLen=40;
var accountLex={data:{keywords:[],filters:[]},ready:false,timer:null,saving:false,again:false};
var accountLexNames={keywords:'搜索关键词库',filters:'评论筛选词库'};
var accountLexIds={
  keywords:{chips:'accountLexKwChips',count:'accountLexKwCount',input:'accountLexKwInput',add:'accountLexKwAdd',bulk:'accountLexKwBulk',importBtn:'accountLexKwImport',msg:'accountLexKwMsg',note:'accountLexKwNote'},
  filters:{chips:'accountLexFlChips',count:'accountLexFlCount',input:'accountLexFlInput',add:'accountLexFlAdd',bulk:'accountLexFlBulk',importBtn:'accountLexFlImport',msg:'accountLexFlMsg',note:'accountLexFlNote'}
};

/** 与服务端 splitTerms 一致：空格、斜杠、逗号、顿号、分号都当分隔符。 */
function accountLexSplit(text){
  return String(text==null?'':text).split(/[\s\/，,、;；|]+/).map(function(t){return t.trim()}).filter(function(t){return !!t});
}

function accountLexClock(){
  var d=new Date();
  return (d.getHours()<10?'0':'')+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();
}

/** 保存状态写在两张卡右上角（同一份词库，两处同步显示）。 */
function accountLexStatus(text,err){
  ['keywords','filters'].forEach(function(kind){
    var el=$('#'+accountLexIds[kind].msg);
    if(!el)return;
    el.textContent=text||'';
    el.className='tiny account-lex-msg'+(err?' account-lex-err':'');
  });
}

/** 卡片底部的即时反馈：加了几条、跳过几条、为什么加不进去。 */
function accountLexNote(kind,text,err){
  var el=$('#'+accountLexIds[kind].note);
  if(!el)return;
  el.textContent=text||'';
  el.className='tiny'+(err?' account-lex-err':'');
}

function accountLexRender(kind){
  var ids=accountLexIds[kind];
  var box=$('#'+ids.chips),cnt=$('#'+ids.count);
  if(!box||!cnt)return;
  var list=accountLex.data[kind]||[];
  cnt.textContent=list.length+' 个'+(list.length>=accountLexMax?'（已满）':'');
  if(!list.length){
    box.innerHTML='<span class="tiny">空词库：输入一个词回车就能加进来。</span>';
    return;
  }
  var html=[];
  for(var i=0;i<list.length;i++){
    var word=esc(list[i]);
    html.push('<span class="chip">'+word+'<button type="button" class="chip-x" title="删除" aria-label="删除 '+word+'" data-account-lex-word="'+word+'">×</button></span>');
  }
  box.innerHTML=html.join('');
  $$('button[data-account-lex-word]',box).forEach(function(b){
    b.onclick=function(){accountLexRemove(kind,b.getAttribute('data-account-lex-word'))};
  });
}

function accountLexRenderAll(){accountLexRender('keywords');accountLexRender('filters')}

/** 拆词后去重追加；超 40 字截断，到 300 个后不再加（服务端也会这样清洗）。 */
function accountLexPush(kind,terms){
  var list=(accountLex.data[kind]||[]).slice();
  var seen={},added=0,dup=0,full=0,cut=0;
  for(var i=0;i<list.length;i++)seen[list[i]]=1;
  for(var j=0;j<terms.length;j++){
    var word=String(terms[j]==null?'':terms[j]).trim();
    if(!word)continue;
    if(word.length>accountLexMaxLen){word=word.slice(0,accountLexMaxLen);cut++}
    if(seen[word]){dup++;continue}
    if(list.length>=accountLexMax){full++;continue}
    seen[word]=1;
    list.push(word);
    added++;
  }
  if(added){
    accountLex.data[kind]=list;
    accountLexRender(kind);
    accountLexTouch();
  }
  return {added:added,dup:dup,full:full,cut:cut};
}

function accountLexStatText(stat){
  if(!stat.added&&!stat.dup&&!stat.full)return '没有可添加的词';
  var parts=[];
  if(stat.added)parts.push('已添加 '+stat.added+' 个');
  if(stat.dup)parts.push('重复 '+stat.dup+' 个已跳过');
  if(stat.full)parts.push('到 300 个上限，'+stat.full+' 个没加');
  if(stat.cut)parts.push('超 40 字的截断 '+stat.cut+' 个');
  return parts.join('，');
}

function accountLexAdd(kind,text){
  if(!accountLex.ready){accountLexNote(kind,'词库没读到，刷新页面再改',true);return}
  var raw=String(text==null?'':text);
  if(!raw.trim()){accountLexNote(kind,'先在输入框里写一个词',true);return}
  var stat=accountLexPush(kind,accountLexSplit(raw));
  accountLexNote(kind,accountLexStatText(stat),!stat.added);
}

function accountLexAddFromInput(kind){
  var input=$('#'+accountLexIds[kind].input);
  if(!input)return;
  accountLexAdd(kind,input.value);
  if(input.value)input.value='';
  input.focus();
}

function accountLexImport(kind){
  if(!accountLex.ready){accountLexNote(kind,'词库没读到，刷新页面再改',true);return}
  var ta=$('#'+accountLexIds[kind].bulk);
  var terms=accountLexSplit(ta?ta.value:'');
  if(!terms.length){accountLexNote(kind,'粘贴框里还没有词',true);if(ta)ta.focus();return}
  var stat=accountLexPush(kind,terms);
  if(ta){ta.value='';ta.focus()}
  var text=accountLexNames[kind]+'：'+accountLexStatText(stat);
  accountLexNote(kind,accountLexStatText(stat),!stat.added);
  toast(text);
}

function accountLexRemove(kind,word){
  if(!accountLex.ready)return;
  var list=(accountLex.data[kind]||[]).filter(function(w){return w!==word});
  if(list.length===(accountLex.data[kind]||[]).length)return;
  accountLex.data[kind]=list;
  accountLexRender(kind);
  accountLexNote(kind,'已删除「'+word+'」',false);
  accountLexTouch();
}

function accountLexTouch(){
  accountLexStatus('待保存…',false);
  accountLexSchedule();
}

function accountLexSchedule(){
  if(accountLex.timer)clearTimeout(accountLex.timer);
  accountLex.timer=setTimeout(function(){accountLex.timer=null;accountLexSave()},600);
}

/** 离开页面时把没到点的改动立刻发出去，别等防抖。 */
function accountLexFlush(){
  if(!accountLex.timer)return;
  clearTimeout(accountLex.timer);
  accountLex.timer=null;
  accountLexSave();
}

/** 服务端清洗后的结果只在「保存期间没再改过这一栏」时才回填。 */
function accountLexAdopt(kind,payloadList,server){
  if(!Array.isArray(server))return;
  var local=accountLex.data[kind]||[];
  if(JSON.stringify(local)!==JSON.stringify(payloadList))return;
  if(JSON.stringify(server)===JSON.stringify(payloadList))return;
  accountLex.data[kind]=server.slice();
  accountLexRender(kind);
}

async function accountLexSave(){
  if(!accountLex.ready)return;
  if(accountLex.saving){accountLex.again=true;return}
  accountLex.saving=true;
  var payload={keywords:(accountLex.data.keywords||[]).slice(),filters:(accountLex.data.filters||[]).slice()};
  accountLexStatus('保存中…',false);
  try{
    var r=await post('/api/lexicon',payload);
    accountLexAdopt('keywords',payload.keywords,r?r.keywords:null);
    accountLexAdopt('filters',payload.filters,r?r.filters:null);
    accountLexStatus('已保存 '+accountLexClock(),false);
  }catch(e){
    accountLex.again=false;
    accountLexStatus('保存失败：'+e.message,true);
  }finally{
    accountLex.saving=false;
    if(accountLex.again){accountLex.again=false;accountLexSave()}
  }
}

async function accountLexLoad(){
  try{
    var r=await api('/api/lexicon');
    accountLex.data.keywords=Array.isArray(r&&r.keywords)?r.keywords.slice():[];
    accountLex.data.filters=Array.isArray(r&&r.filters)?r.filters.slice():[];
    accountLex.ready=true;
    accountLexRenderAll();
    accountLexStatus('',false);
  }catch(e){
    accountLexStatus('词库读取失败：'+e.message,true);
  }
}

/* ---------------------------------------------------------------- ④ 用户 */
async function accountLoadUsers(){
  var tb=$('#accountUserList');if(!tb)return;
  if(!tb.dataset.loaded)tb.innerHTML='<tr><td colspan="4"><p class="loading">读取中…</p></td></tr>';
  try{
    var r=await api('/api/users');
    var me=(omc.state.me||{}).username;
    var list=r.users||[];
    tb.innerHTML=list.map(function(u){
      var self=u.username===me;
      var st=u.status||'active';
      var stBadge=st==='pending'?'<span class="badge warn">待审核</span>':st==='disabled'?'<span class="badge err">已停用</span>':'<span class="badge ok">正常</span>';
      return '<tr>'+
        '<td data-label="用户名">'+esc(u.username)+(self?' <span class="badge">我</span>':'')+'</td>'+
        '<td data-label="角色"><span class="badge'+(u.role==='admin'?' warn':'')+'">'+esc(u.role)+'</span></td>'+
        '<td data-label="状态">'+stBadge+'</td>'+
        '<td data-label="操作"><div class="row">'+
          (st==='pending'?'<button class="sm primary" type="button" data-account-status="'+esc(u.username)+'" data-account-st="active">通过</button>'
            :st==='active'?'<button class="sm ghost" type="button" data-account-status="'+esc(u.username)+'" data-account-st="disabled">停用</button>'
            :'<button class="sm ghost" type="button" data-account-status="'+esc(u.username)+'" data-account-st="active">启用</button>')+
          (u.role==='admin'
            ?'<button class="sm ghost" type="button" data-account-role="'+esc(u.username)+'" data-account-to="user">设为 user</button>'
            :'<button class="sm ghost" type="button" data-account-role="'+esc(u.username)+'" data-account-to="admin">设为 admin</button>')+
          '<button class="sm ghost" type="button" data-account-pw="'+esc(u.username)+'">重置密码</button>'+
          (self?'':'<button class="sm danger" type="button" data-account-del="'+esc(u.username)+'">删除</button>')+
        '</div></td></tr>';
    }).join('');
    tb.dataset.loaded='1';
    var pending=list.filter(function(u){return (u.status||'active')==='pending'}).length;
    $('#accountUsersMsg').textContent='共 '+list.length+' 个用户'+(pending?'，其中 '+pending+' 个待审核':'');
    $$('button[data-account-status]',tb).forEach(function(b){b.onclick=function(){accountSetStatus(b)}});
    $$('button[data-account-role]',tb).forEach(function(b){b.onclick=function(){accountSetRole(b)}});
    $$('button[data-account-pw]',tb).forEach(function(b){b.onclick=function(){accountOpenPwReset(b.dataset.accountPw)}});
    $$('button[data-account-del]',tb).forEach(function(b){b.onclick=function(){accountDeleteUser(b)}});
  }catch(e){
    $('#accountUsersMsg').textContent='用户列表读取失败：'+e.message;
    if(!tb.dataset.loaded)tb.innerHTML='<tr><td colspan="3"><p class="empty">'+esc(e.message)+'</p></td></tr>';
  }
}

async function accountSetStatus(btn){
  var name=btn.dataset.accountStatus;
  var to=btn.dataset.accountSt;
  accountBtn(btn,true,'处理中…');
  $('#accountUsersMsg').textContent='正在'+(to==='active'?'通过 / 启用':'停用')+' '+name+'…';
  try{
    await post('/api/users/'+encodeURIComponent(name)+'/status',{status:to});
    $('#accountUsersMsg').textContent=(to==='active'?'已通过 ':'已停用 ')+name+(to==='active'?'，对方现在可以登录。':'，对方已无法登录。');
    await accountLoadUsers();
  }catch(e){$('#accountUsersMsg').textContent=e.message}
  finally{accountBtn(btn,false)}
}

async function accountSetRole(btn){
  var name=btn.dataset.accountRole;
  var to=btn.dataset.accountTo;
  accountBtn(btn,true,'切换中…');
  $('#accountUsersMsg').textContent='正在把 '+name+' 设为 '+to+'…';
  try{
    await post('/api/users/'+encodeURIComponent(name)+'/role',{role:to});
    $('#accountUsersMsg').textContent='已把 '+name+' 设为 '+to+'（对方的会话已失效，需要重新登录）';
    await accountLoadUsers();
  }catch(e){
    $('#accountUsersMsg').textContent=e.message;
  }finally{accountBtn(btn,false)}
}

async function accountDeleteUser(btn){
  var name=btn.dataset.accountDel;
  if(!confirm('删除用户 '+name+'？他的数据目录不会删。'))return;
  accountBtn(btn,true,'删除中…');
  $('#accountUsersMsg').textContent='正在删除 '+name+'…';
  try{
    await api('/api/users/'+encodeURIComponent(name),{method:'DELETE'});
    $('#accountUsersMsg').textContent='已删除用户 '+name+'（数据目录保留）。';
    accountLoadUsers();
  }catch(e){
    $('#accountUsersMsg').textContent=e.message;
  }finally{accountBtn(btn,false)}
}

function accountOpenPwReset(name){
  accountPwUser=name;
  $('#accountPwResetName').textContent=name;
  $('#accountPwResetInput').value='';
  $('#accountPwResetMsg').textContent='';
  $('#accountPwReset').hidden=false;
  $('#accountPwResetInput').focus();
}

/* ---------------------------------------------------------------- ⑤ 账户使用情况（仅 admin） */
/** 字节按量级换单位，小数值留一位，大数值取整。 */
function accountBytes(v){
  var n=Number(v);
  if(!isFinite(n)||n<=0)return '0 B';
  if(n<1024)return Math.round(n)+' B';
  var kb=n/1024;
  if(kb<1024)return (kb<10?kb.toFixed(1):String(Math.round(kb)))+' KB';
  var mb=kb/1024;
  if(mb<1024)return (mb<10?mb.toFixed(1):String(Math.round(mb)))+' MB';
  return (mb/1024).toFixed(1)+' GB';
}

/** 最近活跃按本地时区显示 YYYY-MM-DD HH:mm（服务端给的是 ISO）。 */
function accountUsageTime(iso){
  if(!iso)return '还没动过';
  var d=new Date(iso);
  if(!d.getTime()||isNaN(d.getTime()))return fmtTime(iso)||'还没动过';
  var pad=function(v){return (v<10?'0':'')+v};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
}

function accountUsageStatus(st){
  return st==='pending'?'<span class="badge warn">待审核</span>'
    :st==='disabled'?'<span class="badge err">已停用</span>'
    :'<span class="badge ok">正常</span>';
}

function accountUsageRow(u){
  return '<tr>'+
    '<td data-label="用户">'+esc(u.username)+(u.role==='admin'?' <span class="badge warn">admin</span>':'')+'</td>'+
    '<td data-label="状态">'+accountUsageStatus(u.status||'active')+'</td>'+
    '<td class="num" data-label="作品">'+esc(u.items==null?0:u.items)+'</td>'+
    '<td class="num" data-label="评论">'+esc(u.comments==null?0:u.comments)+'</td>'+
    '<td class="num" data-label="线索">'+esc(u.leads==null?0:u.leads)+'</td>'+
    '<td class="num" data-label="已发私信">'+esc(u.sent==null?0:u.sent)+'</td>'+
    '<td class="num" data-label="登录态">'+esc(u.logins==null?0:u.logins)+'</td>'+
    '<td data-label="数据占用"><div class="account-usage-io">'+esc(accountBytes(u.bytes))+
      '<div class="tiny">授权文件 '+esc(accountBytes(u.authBytes))+'</div></div></td>'+
    '<td data-label="最近活跃">'+esc(accountUsageTime(u.lastActive))+'</td>'+
    '</tr>';
}

function accountUsageSummary(list){
  var el=$('#accountUsageSum');if(!el)return;
  var pending=0,leads=0,bytes=0,authBytes=0;
  list.forEach(function(u){
    if((u.status||'active')==='pending')pending++;
    leads+=Number(u.leads)||0;
    bytes+=Number(u.bytes)||0;
    authBytes+=Number(u.authBytes)||0;
  });
  el.textContent='共 '+list.length+' 个用户（待审核 '+pending+'）· 总线索 '+leads+' 条 · 总占用 '+accountBytes(bytes)+'，其中授权文件 '+accountBytes(authBytes);
}

async function accountLoadUsage(btn){
  var tb=$('#accountUsageList');if(!tb)return;
  if(!tb.dataset.loaded)tb.innerHTML='<tr><td colspan="9"><p class="loading">读取中…</p></td></tr>';
  if(btn)accountBtn(btn,true,'刷新中…');
  $('#accountUsageMsg').textContent='读取中…';
  try{
    var r=await api('/api/admin/usage');
    var list=(r&&r.users)||[];
    if(!list.length){
      tb.innerHTML='<tr><td colspan="9"><div class="empty"><b>还没有账户数据</b>新建用户或有人开始采集后，这里会显示每个作品、线索和磁盘占用。</div></td></tr>';
      tb.dataset.loaded='1';
      accountUsageSummary([]);
      $('#accountUsageMsg').textContent='';
      return;
    }
    tb.innerHTML=list.map(accountUsageRow).join('');
    tb.dataset.loaded='1';
    accountUsageSummary(list);
    $('#accountUsageMsg').textContent='更新于 '+accountLexClock();
  }catch(e){
    $('#accountUsageMsg').textContent='读取失败：'+e.message;
    if(!tb.dataset.loaded)tb.innerHTML='<tr><td colspan="9"><p class="empty">'+esc(e.message)+'</p></td></tr>';
  }finally{if(btn)accountBtn(btn,false)}
}

/* ---------------------------------------------------------------- 进入页面时加载 */
async function accountLoad(){
  var me=omc.state.me||{};
  var isAdmin=me.role==='admin';
  $('#accountMeName').textContent=me.username||'-';
  $('#accountUsersCard').hidden=!isAdmin;
  if(!isAdmin){
    accountPwUser=null;
    $('#accountPwReset').hidden=true;
  }
  await accountLoadPlatforms();
  var jobs=[accountLoadAccounts(),accountLoadSettings()];
  /* 有没保存的词库改动时保留本地，别被服务端旧数据盖掉 */
  if(!accountLex.timer&&!accountLex.saving)jobs.push(accountLexLoad());
  if(isAdmin)jobs.push(accountLoadUsers());
  await Promise.all(jobs);
  if(accountLoginId)accountWatch(accountLoginId,true);
}

omc.onShow('account',accountLoad);

/* 再次进入（onShow 只在首次触发）时补一次刷新；离开页面时清掉二维码轮询。 */
document.addEventListener('click',function(ev){
  var el=ev.target;
  if(!el||!el.closest)return;
  var nav=el.closest('.nav-item');
  if(!nav)return;
  if(nav.dataset.go==='account'){
    if(omc.shown&&omc.shown.account)accountLoad();
  }else{
    accountLexFlush();
    if(accountQrTimer)accountStopPoll();
  }
},true);

/* ---------------------------------------------------------------- 绑定 */
/* 词库：回车添加（含中文输入法保护）、添加按钮、一键导入 */
function accountLexBind(kind){
  var ids=accountLexIds[kind];
  var input=$('#'+ids.input);
  if(input){
    input.onkeydown=function(ev){
      if(ev.isComposing||ev.keyCode===229)return;
      if(ev.key==='Enter'){ev.preventDefault();accountLexAddFromInput(kind)}
    };
  }
  var add=$('#'+ids.add);
  if(add)add.onclick=function(){accountLexAddFromInput(kind)};
  var imp=$('#'+ids.importBtn);
  if(imp)imp.onclick=function(){accountLexImport(kind)};
}
accountLexBind('keywords');
accountLexBind('filters');

$('#accountPlatform').onchange=function(){
  accountStopPoll();
  accountLoginId=null;
  accountQrHide();
  accountQrReset();
  $('#accountQrMsg').textContent='请用 App 扫码';
  $('#accountAccMsg').textContent='';
  $('#accountHealthMsg').textContent='还没检查过登录态。';
  $('#accountCookieMsg').textContent='';
  var tb=$('#accountList');
  if(tb){tb.dataset.loaded='';tb.innerHTML='<tr><td colspan="4"><p class="loading">读取中…</p></td></tr>'}
  accountLoadAccounts();
};

$('#accountScanBtn').onclick=function(){
  var p=$('#accountPlatform').value;
  if(!p){$('#accountAccMsg').textContent='先选平台';return}
  accountStartLogin({platform:p},this);
};

$('#accountCookieBtn').onclick=function(){
  var v=$('#accountCookie').value.trim();
  if(!v){$('#accountCookieMsg').textContent='先粘贴 Cookie';return}
  var p=$('#accountPlatform').value;
  if(!p){$('#accountCookieMsg').textContent='先选平台';return}
  $('#accountCookieMsg').textContent='';
  accountStartLogin({platform:p,method:'cookie',cookie:v},this);
};

$('#accountHealthBtn').onclick=function(){accountHealth(this)};

$('#accountSetForm').onsubmit=async function(ev){
  ev.preventDefault();
  var btn=$('#accountSetSave');
  var cap=Number($('#accountCap').value),min=Number($('#accountMin').value),max=Number($('#accountMax').value);
  if(!isFinite(cap)||!isFinite(min)||!isFinite(max)){
    $('#accountSetMsg').textContent='三个数字都要填';
    return;
  }
  accountBtn(btn,true,'保存中…');
  $('#accountSetMsg').textContent='保存中…';
  try{
    var batch=Number(($('#accountBatch')||{}).value||0);
    var s=await post('/api/settings',{dailyCap:cap,batchMax:batch,minSeconds:min,maxSeconds:max});
    $('#accountCap').value=s.dailyCap;
    if($('#accountBatch'))$('#accountBatch').value=s.batchMax;
    $('#accountMin').value=s.minSeconds;
    $('#accountMax').value=s.maxSeconds;
    $('#accountSetMsg').textContent='已保存：单日上限 '+s.dailyCap+'，一次最多 '+s.batchMax+' 条，间隔 '+s.minSeconds+'-'+s.maxSeconds+' 秒';
  }catch(e){
    $('#accountSetMsg').textContent='保存失败：'+e.message;
  }finally{accountBtn(btn,false)}
};

$('#accountClearBtn').onclick=async function(){
  var btn=this;
  var v=$('#accountClearConfirm').value.trim();
  if(v!=='确认清空'){
    $('#accountClearMsg').textContent='请输入「确认清空」';
    return;
  }
  accountBtn(btn,true,'清空中…');
  $('#accountClearMsg').textContent='清空中…';
  try{
    var r=await post('/api/settings/clear',{confirm:v});
    var removed=r.removed||[];
    $('#accountClearMsg').textContent='已清空：'+(removed.length?removed.join('，'):'（没有可清的）');
    $('#accountClearConfirm').value='';
    toast('已清空派生数据');
  }catch(e){
    $('#accountClearMsg').textContent='清空失败：'+e.message;
  }finally{accountBtn(btn,false)}
};

$('#accountNewUser').onsubmit=async function(ev){
  ev.preventDefault();
  var form=ev.target,btn=$('#accountNewUserBtn');
  var d=Object.fromEntries(new FormData(form));
  if(!String(d.username||'').trim()){$('#accountNewUserMsg').textContent='用户名不能为空';return}
  if(String(d.password||'').length<8){$('#accountNewUserMsg').textContent='密码至少 8 位';return}
  accountBtn(btn,true,'创建中…');
  $('#accountNewUserMsg').textContent='创建中…';
  try{
    var r=await post('/api/users',d);
    $('#accountNewUserMsg').textContent='已创建 '+(r.username||d.username)+'（'+(r.role||d.role)+'）';
    form.reset();
    await accountLoadUsers();
  }catch(e){
    $('#accountNewUserMsg').textContent='创建失败：'+e.message;
  }finally{accountBtn(btn,false)}
};

$('#accountPwResetSave').onclick=async function(){
  var btn=this,name=accountPwUser;
  if(!name){$('#accountPwResetMsg').textContent='先选一个用户';return}
  var pw=$('#accountPwResetInput').value;
  if(pw.length<8){$('#accountPwResetMsg').textContent='密码至少 8 位';return}
  accountBtn(btn,true,'保存中…');
  $('#accountPwResetMsg').textContent='保存中…';
  try{
    await post('/api/users/'+encodeURIComponent(name)+'/password',{password:pw});
    $('#accountPwResetInput').value='';
    $('#accountPwReset').hidden=true;
    accountPwUser=null;
    $('#accountUsersMsg').textContent='已重置 '+name+' 的密码，他的会话已失效。';
    toast('已重置 '+name+' 的密码');
  }catch(e){
    $('#accountPwResetMsg').textContent='重置失败：'+e.message;
  }finally{accountBtn(btn,false)}
};

$('#accountPwResetCancel').onclick=function(){
  accountPwUser=null;
  $('#accountPwResetInput').value='';
  $('#accountPwResetMsg').textContent='';
  $('#accountPwReset').hidden=true;
};

$('#accountPwSelf').onsubmit=async function(ev){
  ev.preventDefault();
  var form=ev.target,btn=$('#accountPwSelfBtn');
  var me=omc.state.me||{};
  var pw=form.elements.password.value;
  if(!me.username){$('#accountPwSelfMsg').textContent='当前用户未知，刷新页面再试';return}
  if(String(pw).length<8){$('#accountPwSelfMsg').textContent='密码至少 8 位';return}
  accountBtn(btn,true,'保存中…');
  $('#accountPwSelfMsg').textContent='保存中…';
  try{
    await post('/api/users/'+encodeURIComponent(me.username)+'/password',{password:pw});
    form.reset();
    omc.state.me=null;
    omc.shown={};
    toast('密码已改，请重新登录');
    showLogin();
  }catch(e){
    $('#accountPwSelfMsg').textContent='改密码失败：'+e.message;
  }finally{accountBtn(btn,false)}
};
`

export const account: View = {
  id: 'account',
  nav: '账号与设置',
  title: '账号与设置',
  sub: '平台登录状态、发送参数、词库与账户使用情况、用户管理。',
  css: CSS,
  html: HTML,
  js: JS,
}
