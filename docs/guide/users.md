# 多用户与登录

`mediacrawl ui` 要先登录才能用，采集数据按用户隔离。这一页写清楚账号存在哪、密码怎么来的、谁能看到谁的数据，以及哪些地方不是安全边界。

## 用户文件

```
<OMC_HOME 或 ~/.openmediacrawl>/users.json
```

`OMC_USERS_FILE` 可以直接指定文件路径，优先于 `OMC_HOME`。文件不存在或为空当作还没有用户；内容损坏会直接报错并提示路径，不会当成空列表——否则下一次写入会把还能手工修好的数据覆盖掉。

```json
{
  "version": 1,
  "users": [
    {
      "username": "admin",
      "role": "admin",
      "password_hash": "scrypt$16384$8$1$<salt>$<hash>",
      "created_at": "2026-11-12T02:00:00.000Z"
    }
  ]
}
```

- 密码只存 scrypt 哈希（`N=16384`、`r=8`、`p=1`，随机 16 字节 salt）。参数写在哈希串里，将来调参数也还能校验旧密码；校验用 `timingSafeEqual`。
- 用户名规则 `/^[a-z0-9][a-z0-9_-]{2,31}$/`：3-32 位，小写字母或数字开头，可带 `_` 和 `-`。
- 密码 8-128 位。
- 角色只有 `admin` 和 `user`。删除用户、把 admin 降成 user 时都会检查：至少保留一个 admin。
- 状态只有 `pending`（待审核）/ `active`（正常）/ `disabled`（停用）。自助注册的账号是 `pending`，登录会被 403 拒绝；admin 审核通过后变 `active`。旧版 `users.json` 没有 `status` 字段的，一律按 `active` 处理。
- 每次请求都重新读文件，手工改完立刻生效；同一进程内的写入串行化，不会互相覆盖（跨进程不保证）。

## 首次启动

用户列表为空时，`mediacrawl ui` 会建管理员 `admin`，把密码打印在终端：

```
首次启动，已创建管理员 admin / k7mPq2xR9tWz
登录后可在页面里改密码或新建用户；用户数据各自独立，admin 能看到全部。
```

- 密码取 `OMC_ADMIN_PASSWORD`。设了但短于 8 位会**启动直接报错**，不会悄悄换成随机密码——否则没人知道密码是什么。
- 没设就随机生成 12 位，字符集去掉了 `0/O`、`1/l/I` 这类容易看错的字符，只打印这一次。
- 用户列表非空时不会再建。忘了密码只能删掉 `users.json` 重新引导（所有用户一起丢），或者自己生成一条 scrypt 哈希写回去。

## 会话

- 登录成功下发 `omc_session` cookie：`HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age` 7 天。
- 会话表只在进程内存里，**进程重启后所有登录失效**，重新登录即可。
- 改密码、改角色、删用户会立刻清掉该用户名下的全部会话，那个用户下一次请求就是 401。
- 同一个用户名连续登录失败 5 次后锁 30 秒，这期间再试返回 429；成功登录后计数清零。
- `POST /api/logout` 删会话并让浏览器丢掉 cookie。
- 同一个浏览器只有一个 `omc_session`，换账号要先退出（或者用隐私窗口 / 另一个浏览器）。

## 数据隔离

`mediacrawl ui --out <目录>`（默认 `./data`）下面按用户分目录：

```
data/
└── users/
    ├── admin/
    │   ├── xhs/search_item_2026-11-01.jsonl   # 自己采的数据、断点续爬状态、媒体
    │   └── .catbus/                            # 自己的登录态（CATBUS_HOME）
    └── alice/
        ├── douyin/...
        └── .catbus/
```

- 每个用户的任务都写到自己的 `users/<用户名>/`；断点续爬状态、`media/`、SQLite 库都在里面。
- 登录态用独立的 `CATBUS_HOME`：`users/<用户名>/.catbus/`。页面里扫码或粘贴 Cookie 只影响自己的账号，不动全局 `~/.catbus`。后端子进程（采集、登录、互动）都带着这个环境变量跑。
- `GET /api/jobs` 只返回自己的任务；`GET /api/jobs/:id/events` 读别人的任务返回 404。
- `GET /api/files?path=` 只能读自己目录下的文件，路径解析后不在自己的根目录里就返回 403（`..` 也挡）。
- admin 例外：任务列表里能看到所有用户的 job（页面上标出 owner），文件可以加 `?user=<用户名>` 读别人的。

## 页面里能做什么

| 操作 | 谁能做 | 说明 |
|---|---|---|
| 改自己的密码 | 任何登录用户 | 左栏「我的账号」卡片；也可以直接调 `POST /api/users/<自己>/password`。改完当前会话立刻失效，要重新登录 |
| 新建用户 | admin | 用户名、初始密码、角色（`user` / `admin`） |
| 自助注册 | 公开 | 姓名（真实姓名）、密码；只能得到 `user` + `pending` |
| 审核 / 停用 | admin | `POST /api/users/<姓名>/status`，body `{"status":"active"|"disabled"}` |
| 重置密码 | admin | `POST /api/users/<姓名>/password`，会话立即失效 |
| 升 / 降权 | admin | 降最后一个 admin 会被拒绝 |
| 删除用户 | admin | 只删用户记录，`users/<用户名>/` 下的数据不删 |

改完密码要重新登录，页面会直接把登录框弹回来。

## 接口

| 接口 | 说明 |
|---|---|
| `POST /api/login` | `{username, password}`，成功下发 cookie，返回 `{username, role}` |
| `POST /api/logout` | 删掉当前会话 |
| `GET /api/me` | 当前用户 `{username, role}`，未登录 401 |
| `GET /api/users` | 用户列表（admin），只返回用户名、角色、创建时间 |
| `POST /api/users` | 新建用户 `{username, password, role}`（admin），成功 201 |
| `DELETE /api/users/:name` | 删除用户（admin） |
| `POST /api/users/:name/role` | `{role: "admin" \| "user"}`（admin） |
| `POST /api/users/:name/password` | `{password}`，自己或 admin |

公开的只有 `/`（页面本身）和 `POST /api/login`。`GET /api/me` 未登录返回 401，`POST /api/logout` 没会话也返回 `{ok:true}`。其余接口没带 cookie 一律 401，权限不够 403。

## 安全边界

- **单进程**：会话、任务、限流记录都在一个 Node 进程的内存里。不要用多实例、PM2 cluster 或容器副本跑同一个 UI，否则登录会随机失效、限流也会各算各的。
- **没有 HTTPS**：默认只监听 `127.0.0.1`，cookie 也没加 `Secure`。要放到局域网或公网，先自己套一层 HTTPS 反向代理，并接受下面的隔离强度——这不是为多租户公网部署设计的功能。
- **文件级隔离，不是加密**：隔离靠的是路径前缀检查。能读这台机器文件系统的人可以直接打开 `users/<用户名>/`，也可以直接改 `users.json` 给自己提权。它挡的是同一个 UI 里的其他用户，不是本机的其他系统用户。
- `users.json` 里的哈希和 `users/<用户名>/.catbus/` 里的登录态都等同于密码，别提交到 git、别打包分享、别贴到 issue 里。
- 删掉用户后数据目录还在，`users/<用户名>/` 需要自己清理。

## 群发参数（admin 统一设置）

单日上限、一次最多、发送间隔存在 `send-config.json`（和 `users.json` 同目录，容器里是 `/data/omc/send-config.json`），所有账号共用：

| 项 | 默认 | 范围 |
|---|---|---|
| 单日上限 | 25 条 | 1-200 |
| 一次最多 | 50 条 | 1-200 |
| 最小间隔 | 30 秒 | ≥5 |
| 最大间隔 | 90 秒 | ≥ 最小间隔 |

- 只有 admin 能改：控制台「用户管理 → 群发参数」，或「账号与设置 → 群发参数」；其他账号看到的是只读值，`POST /api/settings` 返回 403。
- 群里「一次最多」同时是 `POST /api/campaigns` 的硬校验：超过会直接 400，不会排队。
- 触达页「群发设置」默认类型是统一私信，回复那条评论要手动切。

