/**
 * 全局运行时：DOM/请求/格式化小工具 + 登录 + 路由 + toast。
 * 以字符串形式注入页面，与各视图的 js 共享同一作用域。
 */
export const KIT_JS = String.raw`
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function num(v){return v==null?'-':(v>=10000?(v/10000).toFixed(1)+'w':String(v))}
function nl(){return String.fromCharCode(10)}
function fmtTime(iso){return String(iso||'').replace('T',' ').slice(0,16)}
async function api(url,opt){var r=await fetch(url,opt);var j=await r.json().catch(function(){return{}});if(!r.ok){var e=new Error(j.error||('HTTP '+r.status));e.status=r.status;throw e}return j}
function post(url,payload){return api(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})}
function toast(msg,kind){
  var el=$('#toast');el.textContent=msg;el.className='toast '+(kind||'');el.hidden=false;
  clearTimeout(el._t);el._t=setTimeout(function(){el.hidden=true},2600);
}
var omc={
  state:{me:null,platforms:[],jobsRunning:0},
  hooks:{},views:{},meta:{},_show:{},_login:[],shown:{},
  onShow:function(id,fn){(omc._show[id]=omc._show[id]||[]).push(fn)},
  onLogin:function(fn){omc._login.push(fn)},
  hook:function(name,fn){omc.hooks[name]=fn},
  call:function(name,arg){var f=omc.hooks[name];if(typeof f==='function')return f(arg)},
  go:function(id){go(id)},
  $:$,$$:$$,esc:esc,num:num,api:api,post:post,toast:toast,nl:nl,fmtTime:fmtTime
};
window.omc=omc;

function go(id){
  if(!omc.views[id])id='overview';
  $$('.view').forEach(function(s){s.hidden=s.dataset.view!==id});
  $$('.nav-item').forEach(function(b){if(b.dataset.go===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  var m=omc.meta[id]||{};
  $('#viewTitle').textContent=m.title||id;
  $('#viewSub').textContent=m.sub||'';
  if(location.hash!=='#/'+id)history.replaceState(null,'','#/'+id);
  if(!omc.shown[id]){
    omc.shown[id]=1;
    (omc._show[id]||[]).forEach(function(f){try{f()}catch(e){console.error('['+id+']',e);toast('页面加载失败：'+e.message,'err')}});
  }
}
$$('.nav-item').forEach(function(b){b.onclick=function(){go(b.dataset.go)}});
$('#refreshAll').onclick=function(){
  var id=location.hash.replace('#/','')||'overview';
  omc.shown[id]=0;go(id);toast('已刷新');
};

async function refreshRunBadge(){
  try{
    var list=await api('/api/jobs');
    var n=list.filter(function(j){return j.status==='running'}).length;
    omc.state.jobsRunning=n;
    var b=$('#runBadge');
    if(n){b.hidden=false;b.textContent='● '+n+' 个任务运行中';b.className='badge run'}
    else{b.hidden=true}
  }catch(e){}
}
$('#runBadge').onclick=function(){go('reach')};

$('#loginForm').onsubmit=async function(ev){
  ev.preventDefault();
  var d=Object.fromEntries(new FormData(ev.target));
  try{await post('/api/login',d);$('#loginMsg').textContent='';boot()}catch(e){$('#loginMsg').textContent=e.message}
};
$('#registerForm').onsubmit=async function(ev){
  ev.preventDefault();
  var d=Object.fromEntries(new FormData(ev.target));
  var msg=$('#registerMsg');
  if(String(d.username||'').trim().length<2){msg.textContent='请填真实姓名';return}
  if(d.password!==d.confirm){msg.textContent='两次输入的密码不一样';return}
  try{
    var r=await post('/api/register',{username:d.username,password:d.password});
    msg.textContent='已提交，等管理员通过「'+r.username+'」的申请后就能登录';
    ev.target.reset();
  }catch(e){msg.textContent=e.message}
};

$('#logout').onclick=async function(){
  try{await post('/api/logout',{})}catch(e){}
  omc.state.me=null;omc.shown={};showLogin();
};
function showLogin(){$('#login').hidden=false;$('#app').hidden=true;var u=$('#loginForm input[name=username]');if(u)u.focus()}
function showApp(){
  $('#login').hidden=true;$('#app').hidden=false;
  var me=omc.state.me||{};
  $('#who').innerHTML='<b>'+esc(me.username||'')+'</b>'+(me.role==='admin'?' · admin':'');
  var start=location.hash.indexOf('#/')===0?location.hash.slice(2):'overview';
  go(start);
  omc._login.forEach(function(f){try{f()}catch(e){console.error(e)}});
  refreshRunBadge();setInterval(refreshRunBadge,15000);
}
async function boot(){try{omc.state.me=await api('/api/me');showApp()}catch(e){showLogin()}}
`;
