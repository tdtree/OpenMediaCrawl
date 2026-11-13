# 更新日志

本项目的所有重要变更都记录在这里。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]（批量采集层）

### Added

- 群发参数改为 admin 统一设置（`send-config.json`，和 `users.json` 同目录）：单日上限默认 25、一次最多 50、间隔 30-90 秒；所有账号共用，普通账号只读
- 「用户管理 → 群发参数」与「账号与设置 → 群发参数」两处可改（仅 admin）；群发接口按一次最多条数校验，护栏默认单日上限 20 → 25
- 触达页「群发设置」默认类型改为统一私信，私信排在前

- 数据清理：`GET/POST /api/admin/cleanup` 预览并删除「超过 N 天、且从未被任何筛选词命中」的评论正文；筛选词 = 词库过滤词 + 历史用过的（`filter-history.json`）；保留线索、发送记录、会话与断点状态，重爬不重复抓取；缺时间字段的行跳过，删除前留 `.bak`
- 「用户管理 → 数据清理」面板：7/30/90 天切换、按用户预览、候选体积、输入「确认清理」二次确认、执行结果就地回显；admin 侧栏显示待清理条数徽标
- Web 控制台镜像：`Dockerfile.web` + `.github/workflows/docker.yml` 推 `ghcr.io/tdtree/openmediacrawl:latest|sha|tag`；`ui` 命令支持 `--host`/`OMC_UI_HOST`，容器内监听 0.0.0.0，数据卷 `/data`
- `compose.yaml` 增加 `web` 服务与 `omc-data` 卷；文档补局域网访问、防火墙、备份与清理规则

- 采集表单二次收紧：平台/类型/最多条数/排序合并成一行四列（≤1100 两列、≤640 单列），关键词占整行；词数并入标题行、提交说明与按钮同一行，整表单 437→287px；去掉重复的 `crawlCmFilterN`
- 细节合规：占位符统一以 … 结尾、封面图补 width/height、滚动容器加 `overscroll-behavior: contain`、必填星号只跟在字段名后

- 用户管理支持按天展开：点某天的「查看」就地展开当天任务（关键词/类型/作品/评论/状态）、线索（评论者/评论/地域/联系方式/来源作品）、发送与会话；`GET /api/admin/day?user=&date=`
- 采集任务结束时额外记录本次作品 ID（最多 300），供当天明细定位
- 线索搜索改为词块编辑（空格/斜杠/逗号切词、可删、可从词库导入），命中的关键词在评论、评论者与展开详情里高亮
- 采集表单收紧：输入框 30px、字段间距 8px、数字类字段限宽 150px，一屏可见基础+范围

- 左侧栏新增「用户管理」（仅 admin）：按天统计每个账号的关键词、作品、评论、群发、沟通客户（去重），另有账号概览（累计数量 / 登录态 / 磁盘与授权文件占用 / 最近活跃），支持 7/14/30 天与按用户筛选
- `GET /api/admin/activity?days=N`（仅 admin）；每次采集结束写 `jobs.jsonl`（关键词/作品数/评论数/状态），供按天统计
- 非 admin 看不到入口，直接访问 `#/admin` 会被路由拦回概览，接口返回 403

- 词库：每个用户一份 `lexicon.json`（关键词库 + 评论筛选词库），`GET|POST /api/lexicon`；采集页可一键导入、词块增删，账号页可视化维护
- 采集关键词/评论筛选用词块输入：空格、/、逗号、回车都切词，提交仍按逗号传给后端；评论正文命中筛选词时高亮
- 私信会话：`chat.jsonl` 本地记录（发出/收到），`GET /api/chat/threads|messages`、`POST /api/chat/send|sync`；触达页新增「私信会话」tab，支持多轮对话（平台支持 msg history 时可由「同步历史」拉取对方消息）
- 账户使用情况面板（admin）：`GET /api/admin/usage` 汇总每个账号的作品/评论/线索/已发私信/登录态数量、数据与登录态占用、最近活跃时间
- 侧栏 GitHub 链接只对 admin 可见

- 账号自助注册 + 审核：登录页可申请（账号必须填真实姓名，2-30 位中文；密码自己设），新账号为 `pending`，管理员通过后才能登录
- 用户状态 `pending/active/disabled`：登录按状态拒绝并给出原因；admin 可「通过 / 停用 / 启用 / 重置密码」，停用或改密会立即踢掉会话；旧 `users.json` 无 status 时按 active 兼容
- 账号名同时支持中文真实姓名与机器名（小写字母/数字/_/-）；`verifyUser` 同步放开
- 页脚整行去掉，GitHub 链接移到侧栏底部

- 按 Web Interface Guidelines 做了无障碍/交互收口：新增跳转主内容链接、`<main>` 语义、toast `role=status aria-live`、`theme-color`、`text-wrap:balance`、`touch-action:manipulation`、`overscroll-behavior`、`prefers-reduced-motion`、移动端 40px 点按高度、评论卡片 `content-visibility`
- 概览柱状图刻度统一为 `MM-DD`，移动端不再只显示日号

- 视觉方向改为「台账 / 蓝铅笔批注」：墨黑正文（#171a1e）、纸白底（#f6f6f3）、单一信号色靛蓝（#1c46c8）；标题用宋体（Songti/SimSun），正文系统黑体；卡片圆角 10→6、输入 6→4、徽标从胶囊改 3px 方签；侧栏选中改为左侧 2px 竖线
- 概览的 4 个指标从「四张同款卡片」改为一条带上下细线、竖线分隔的台账式数据行；柱状图去掉零值柱与圆角，只保留基线、刻度和当天柱

- 线索表去掉恒空的「命中词」列（自动同步不按意向词过滤）；表格表头在表格区内吸顶，表格最高占满一屏（`calc(100vh-170px)`）自带滚动
- 采集表单「评论」默认勾选；二级评论勾选会自动带上评论
- 线索搜索框与采集页评论筛选统一口径：空格或 `/` 分隔、OR 匹配、大小写不敏感

- 评论采集默认不再截断：`maxComments` 默认 0 = 不限，客户端在 0 时传 `--all`（自动翻页）；表单高级组可填上限
- `scripts/backfill-comments.mjs`：按作品补全已落盘评论（`--all` 一级 + `--replies` 楼中楼），按 comment id 增量合并，默认干跑，`--write` 先备份
- 线索搜索支持多关键词：`q` 按空格或 `/` 拆分，OR 匹配评论正文与昵称
- `POST /api/leads/sync`：把已采评论全量同步进线索库（按评论 ID 去重），前端打开线索页时自动调用，去掉手动「生成线索」
- `POST /api/candidates/bulk`：评论多选后批量加入回复/私信候选

- 前端重构为「侧栏 + 5 个视图」：概览 / 采集 / 线索 / 触达 / 账号与设置，hash 路由（`#/leads`），单文件从 573 行拆成 `src/crawl/ui/{theme,shell,kit,index}.ts` + `views/*.ts`
- 概览：4 个指标、14 天柱状（基线/刻度/今日高亮/0 值底线）、平台占比、运行状态，全部走设计令牌，无图表库
- 采集：表单分基础/范围/高级三组，主按钮定宽右对齐；已采数据改 master-detail（作品列表 + 评论树），评论可直接加候选或回复
- 线索：表格化（勾选/评论者/评论/联系方式/地域/命中词/时间/详情），筛选即查（300ms 防抖）、行内展开详情、分页 50 条、导出全部或选中
- 触达：候选池（勾选批量移除）+ 群发设置 + SSE 日志 + 任务列表（可停止、可展开日志）+ 单条互动折叠
- 账号与设置：平台登录（扫码/ Cookie / 健康检查）、发送参数、危险区、用户管理（admin），普通用户只能改自己密码
- 新增 `GET /api/leads/stats`（全库总数/有联系方式数/省份列表）、`GET /api/jobs/:id/log`（任务日志按行返回）、`/api/leads/export.csv` 支持 `ids=` 导出选中
- 导出上限从 500 放开到 20000（`LeadStore.query` 支持 `maxLimit`）

- 地域：`Comment` 增加可选 `province`，抖音 web 评论把 `ip_label` 透传进来（其他平台暂空）；线索支持按省份过滤，仪表盘 / 线索列表 / CSV 都会显示地域
- `scripts/backfill-province.mjs`：给已落盘的评论按作品补地域（含楼中楼），默认干跑，`--write` 才改文件并先存 `.bak`

- 本地 Web UI 多用户：用户存 `<OMC_HOME|~/.openmediacrawl>/users.json`（`OMC_USERS_FILE` 可覆盖路径），密码 scrypt 哈希，角色 `admin` / `user`，任何时候至少保留一个 admin；首次启动自动建 `admin`，密码取 `OMC_ADMIN_PASSWORD`，没设就随机生成并打印在终端
- 登录会话：`POST /api/login`、`POST /api/logout`、`GET /api/me`，会话在内存里，cookie 为 `omc_session`（HttpOnly、SameSite=Lax、7 天），进程重启需重新登录，改密码 / 改角色 / 删用户会立刻失效该用户的会话
- `GET|POST /api/users`、`DELETE /api/users/:name`、`POST /api/users/:name/role`、`POST /api/users/:name/password`；页面给 admin 提供用户列表、新建、删除、升降权
- 按用户隔离：采集数据写到 `<--out>/users/<用户名>/`，登录态用独立的 `CATBUS_HOME`（`<--out>/users/<用户名>/.catbus/`）；`/api/jobs` 只返回自己的任务，`/api/files` 增加 `user=` 参数（admin 可读其他用户），页面里 admin 能看到所有人的任务
- 互动面板：`POST /api/action` → `src/crawl/actions.ts` → 子进程调 CLI，发评论 `<平台> comment add <目标> <文本> [--reply-to <评论 ID>]`、发私信 `<平台> msg send <文本> --to <目标>`；平台白名单为 comment = douyin、bilibili，dm = douyin、xhs、tiktok、xianyu、taobao、jd，新增 `GET /api/actions/platforms`
- 互动限流：同一平台 + 账号最小间隔 3 秒（`MEDIACRAWL_ACTION_INTERVAL_MS` 可改），太快返回 `TOO_FAST`；正文上限 500 字；不重试，风控和登录失效把错误原样透出
- 结果预览改为详情抽屉：点卡片在右侧展开封面、标题、正文、作者、赞 / 评 / 收藏和原页链接，不再直接跳转
- `src/crawl/client.ts` 的 `runCatbus` 接受 `env`，可以给每次子进程调用指定 per-user 的 `CATBUS_HOME`
- 新增 `docs/guide/users.md`

### Changed

- `POST /api/login` 改为用户名 + 密码登录（原来用于启动扫码登录）；扫码登录启动改到 `POST /api/login/start`，`GET /api/login/:id` 不变
- 本地 Web UI 重写：左侧账号区（平台下拉、扫码登录、二维码、粘贴 Cookie 登录、账号列表带「切换」），结果预览区把 SSE 的 item 事件实时渲染成卡片、点开原页；新增 `GET /api/platforms`、`GET /api/accounts?platform=`、`POST /api/accounts/use`、`POST /api/login`、`GET /api/login/:id`、`GET /api/qrcode?platform=`，原有 `/`、`/api/jobs`、`/api/jobs/:id/events`、`/api/files` 不变
- 断点续爬升级为关键词级 + 游标级：状态文件新增 `tasks`（按 `search:<关键词>` / `creator:<博主 id>` 记 `cursor` 和 `done`）和 `finished`（上一轮是否正常跑完）；上一轮正常跑完时 id 只当去重集合、关键词重查一遍，上一轮中断时已完成的任务整段跳过、没跑完的从存下的游标继续，游标每拿到一次就落盘

## [0.1.0] - 2026-11-01

### Added

- OpenMediaCrawl 批量采集命令、断点续采、JSON/JSONL/CSV/SQLite 存储、媒体下载、评论词云和本地 Web UI。
- `mediacrawl` 主命令与 `catbus` 兼容入口并存；原有 catbus 平台命令保持可用。

## [Unreleased]

### Added

- 新增 `jimeng`（即梦，别名 `dreamina`）平台：管理即梦官方 CLI `dreamina` 的多账号登录态，不注册生成类命令
  - `auth login`：浏览器授权（新登录方式 `oauth`），由 `dreamina` 发起设备码授权，把钥匙串里的登录态存到账号名下
  - `auth use`：把目标账号的登录态写回钥匙串，之后直接运行 `dreamina` 就是这个账号
  - `auth status`：用 `dreamina user_credit` 在线校验；`auth logout`：钥匙串里正是这个账号时同时 `dreamina logout`
  - `dreamina` 自己刷新 token 后，catbus 在下次改写钥匙串前把最新值存回所属账号
  - 只支持 macOS，需要先安装 `dreamina`
- core：端声明新增 `use` 钩子，`auth use` 设置当前账号前调用（AGENTS 5.3、5.6）
- 新增 `docs/platforms/jimeng.md`、AGENTS.md 5.6，更新能力矩阵、登录指南、Agent 技能和 llms.txt
- `user update`：修改当前账号的昵称（`--name`）、头像（`--avatar`）、简介（`--bio`），只改给出的字段，返回修改后的 User
- bilibili：`user update`，接口按网页端个人中心 `account.bilibili.com` 补（`x/member/web/sign/update`、`face/update`、`web/update`），上游没有，没有对拍。改昵称前先查 `uname/update/message` 的资格；改昵称扣硬币，带 `--name` 时需要确认

### Fixed

- 能力矩阵的「登录方式」表按 `LOGIN_METHODS` 生成，不再写死 4 种方式

## [0.2.1] - 2026-10-22

### Added

- bilibili：`feed list --kind following`，关注的人的视频投稿（动态流 `x/polymer/web-dynamic/v1/feed/all`，`type=video`），游标是接口返回的 `offset`；需要登录。上游没有这个接口，请求按网页端动态页补，没有对拍

- 新增 `12306`（12306 铁路）平台，支持公开只读查询功能：
  - 车站检索（`station search`）：支持中文站名、拼音全拼/首字母前缀、电报码，车站字典本地缓存 24 小时
  - 余票查询（`ticket search`）：直达列车与余票信息，支持 `--date`、`--type`（车型过滤）、`--available`（只看有票），输出统一 `Ticket` 与 `Station` 对象及 12306 深链
  - 票价详情（`ticket price`）：各席别价格详情，输出标准 `Price { amount, currency }`
  - 经停时刻（`route get`）：全途经停站、到达/发车时间、停留时长
  - 中转方案（`transfer search`）：两段换乘方案，支持 `--via` 指定换乘站、`--limit` 限制方案数量，支持「同车换座」标记
- 平台架构支持免登录（`guest: true`）模式，无需登录态直接调用查询命令
- 新增 `12306` 离线单元测试与在线 E2E 测试
- 新增 `docs/platforms/12306.md`，更新能力矩阵（`docs/capabilities.md`）、Agent 技能与多语言 README

### Fixed

- 小红书：扫码登录确认后 471（antiSpam）——登录链补 X25519 客户端公钥与 ssk 解密（App 9.43.1 协议，原语同上游 Spider_XHS）
- 小红书：发布笔记 -9059 参数错误——body 对齐 2026-10-17 现网 schema（视频 business_binds 去 coProduceBind、copyable 按类型）
- 小红书：可见范围映射勘误（浏览器下拉实测）：`--private` 对应 `privacy_info.type=1`（0=公开、1=仅自己可见、2=仅互关好友）
- 抖音：图文/视频发布空描述时 text_extra 补尾部分隔符，对齐网页端

### Changed

- 小红书：指纹族刷新到 2026-10-17 现网（webBuild 6.57.6 / Chrome 155），b1 与浏览器逐字节对齐（PC 1784 / 创作者 1868 字节），webprofile 参考档案按 82 字段实测重建
- 小红书：461/471 风控支持 App 扫码验证链（verifytype 124），qr/init 前自动重跑安全引导
- 抖音：passport SDK 版本族升到现网（jssdk 3.4.9 / p_ui 2.4.10 / p_zt 3.3.30 / p_ver 1.1.4-beta.5 / p_ca_real 1.0.0.938），UA Chrome/155
- 抖音：dtrait 内层 blob 与真实设备逐字节对齐（176 字节）；msToken 184 字节的差距由 TLS ClientHello 版本决定，curl_cffi 体系内为已知限制
- 抖音：Cookie 头按浏览器 wire 顺序序列化（45 键线序），安全 SDK cookie 与 web_sign_token 补齐收集
- 抖音：创作者域 msToken 独立轮换通道（ms_appid=2906，与主站分开）

## [0.1.0] - 2026-10-06

首个版本。

### Added

- 10 个平台的 web 端：小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。能力移植自 [cv-cat](https://github.com/cv-cat) 的开源项目，用 TypeScript 重写，请求与上游逐字节对拍。各平台支持的命令见 [能力矩阵](docs/capabilities.md)，用法与已知限制见 [各平台说明](docs/platforms/README.md)。
- 统一的命令语法 `catbus <platform> <resource> <action>`：含义相同的能力在所有平台上同名（笔记、作品、推文一律是 `item`），用了平台原生叫法时提示规范词；四层中文帮助。
- 输出：stdout 只有 JSON 信封，`-o json|jsonl`，跨平台统一的归一化类型，`--raw` 输出平台原始对象；退出码 0–7。
- 登录：扫码、短信、账密、cookie 导入（各平台支持的方式不同）；登录态按 平台 × 端 × 账号 隔离在 `~/.catbus/`，`-a` 切换账号，会自动续期的凭证自动写回。
- 分页 `--limit` / `--cursor` / `--all`；`item download` 下载媒体；`listen` 监听直播弹幕和私信，断线自动重连。
- 发布：图文、视频、文章，支持仅自己可见、定时、地点、话题等选项（各平台的取舍见能力矩阵）。
- 验证码：快手滑块、B 站极验点选、京东 JCAP 在本地自动识别，模型放在 `@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr`。
- 全局命令：`platforms`、`doctor`、`auth list`、`config`、`version`；代理可以全局、按平台或单次设置。
- 给 AI Agent 用：Agent 技能（`npx skills add cv-cat/catbus`）和 [llms.txt](llms.txt)。
- Docker 镜像与 Compose。
- 只需要 Node（`^22.22.2 || ^24.15.0 || >=26.0.0`），支持 Windows、macOS、Linux 的 x64 / arm64（Linux 含 glibc 与 musl）。

[Unreleased]: https://github.com/cv-cat/catbus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cv-cat/catbus/releases/tag/v0.1.0
