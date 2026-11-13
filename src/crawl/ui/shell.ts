/** 登录页 + 应用壳（侧栏 / 页头 / 视图容器）。 */
export const LOGIN_HTML = `
<section id="login" hidden>
  <div class="card">
    <h1>OpenMediaCrawl</h1>
    <p class="sub">本地采集台，先登录。</p>
    <form id="loginForm">
      <label class="field"><span>用户名</span><input name="username" autocomplete="username"></label>
      <label class="field" style="margin-top:8px"><span>密码</span><input name="password" type="password" autocomplete="current-password"></label>
      <button class="primary" style="margin-top:12px;width:100%">登录</button>
    </form>
    <p class="hint" id="loginMsg"></p>
  </div>
</section>`

export const APP_HTML = `
<div id="app" hidden>
  <a class="skip" href="#main">跳到主要内容</a>
  <div class="app">
    <nav class="side" aria-label="主导航">
      <div class="brand">OpenMediaCrawl</div>
      <button class="nav-item" data-go="overview">概览</button>
      <button class="nav-item" data-go="crawl">采集</button>
      <button class="nav-item" data-go="leads">线索</button>
      <button class="nav-item" data-go="reach">触达</button>
      <button class="nav-item" data-go="account">账号与设置</button>
      <div class="side-foot">
        <span class="who tiny" id="who"></span>
        <button class="ghost sm" id="logout">退出登录</button>
        <a class="side-link" href="https://github.com/Tommyapi/OpenMediaCrawl" target="_blank" rel="noopener" title="github.com/Tommyapi/OpenMediaCrawl">GitHub ↗</a>
      </div>
    </nav>
    <main class="main" id="main">
      <header class="top">
        <div class="top-t"><h1 id="viewTitle">概览</h1><p class="sub" id="viewSub"></p></div>
        <span class="spacer"></span>
        <button class="badge run" id="runBadge" hidden></button>
        <button class="ghost sm" id="refreshAll">刷新</button>
      </header>
      <div id="viewRoot"><!--VIEWS--></div>
    </main>
  </div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`
