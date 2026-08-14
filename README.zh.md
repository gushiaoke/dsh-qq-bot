# dsh-qq-bot

[English](README.md) | 中文

面向模型的 `qq_send_message` 工具：通过 [QQ 机器人开放平台](https://bot.q.qq.com)（`api.bot.qq.com`）向 QQ 单聊用户或群聊发送文本消息。配置 `inbound: true` 时，还能通过 WebSocket 网关接收 QQ 消息并驱动 agent。它是一个**实现**包——只把工具注册进 `ctx.tools`，不拥有 `ctx.tools` 键，也不注册任何服务键。

## 作用

在 `ctx.tools` 上注册 `qq_send_message(channel, openid, content, format?)`。`channel` 为 `"user"` 表示单聊（目标是用户 openid），`"group"` 表示群聊（目标是群 openid）。`format` 为 `"text"`（默认）或 `"markdown"`。一次调用会先换取 Access Token（`POST /app/getAppAccessToken`，携带 AppID/AppSecret），再发送消息（`POST /v2/users/{openid}/messages` 或 `/v2/groups/{openid}/messages`，请求头 `Authorization: QQBot <access_token>`；文本请求体 `{ content, msg_type: 0 }`，Markdown 请求体 `{ markdown: { content }, msg_type: 2 }`）。

Access Token 有效期为 2 小时；`QqBotClient` 会缓存并在到期前 60 秒窗口内刷新。Markdown 支持 QQ 文档列出的子集——标题、加粗/斜体/删除线、链接、图片（公网 URL）、有序/无序列表、块引用与水平分割线；代码块与表格不在文档列表中。富媒体与内置键盘未由本工具投射。

配置 `inbound: true` 时，本包会启动一条出站的 WebSocket 网关连接（`QqBotGateway`）。它将每个 QQ 单聊 / 群聊映射到一个专属 agent 会话，把入站的 `C2C_MESSAGE_CREATE` / `GROUP_AT_MESSAGE_CREATE` 文本经 `followup` 灌入，并把该轮最终提交的 assistant 文本回推给发送者。鉴权复用同一对 AppID/AppSecret——Identify 的 `token` 为 `QQBot <access_token>`，intents 为 `1 << 25`——因为网关是出站连接，无需公网回调地址。

## 安装

前置条件：已安装 `dsh`（`dsh` 命令在 `PATH` 中），且目标 profile 的 bundles 提供 `ctx.tools` 与 `ctx.agents` 服务（`@deepseek-ai/dsh-base` 两者都提供；`dsh plugin` 首次使用时会将其初始化为默认 bundle）。

1. 将插件添加到某个 profile：

```sh
dsh plugin --profile <名字> add github:gushiaoke/dsh-qq-bot
```

2. 挂载：在 profile 的补丁层 `~/.dsh/profiles/<名字>/cordis.patch.yml` 追加一条 `insert` 条目：

```yaml
- insert:
    - id: qq-bot
      name: 'dsh-qq-bot'
      config:
        appId: !!js process.env.QQBOT_APP_ID ?? ''
        appSecret: !!js process.env.QQBOT_APP_SECRET ?? ''
        inbound: true
        inboundProvider: deepseek-official
        inboundModel: deepseek-v4-flash
        inboundFormat: markdown
        inboundCwd: /absolute/working/directory
```

3. 配置凭证（见下文「凭证」章节）并启动：

```sh
dsh --profile <名字>
```

## 凭证（AppID + AppSecret）

在 [QQ 机器人开发者后台](https://q.qq.com/#/apps) 创建机器人，复制其 **AppID**（机器人 ID）和 **AppSecret**（密钥）。旧的 `Token` 凭证已废弃，无需配置。

按优先级（环境变量 > 项目 `.env` > harness-home `.env`）三选一提供：

**方式一：环境变量**（生产推荐）：

```bash
export QQBOT_APP_ID="<你的-app-id>"
export QQBOT_APP_SECRET="<你的-app-secret>"
```

```powershell
$env:QQBOT_APP_ID = "<你的-app-id>"
$env:QQBOT_APP_SECRET = "<你的-app-secret>"
```

**方式二：`.env` 文件**（放在调用目录或 `~/.dsh/.env`）：

```
QQBOT_APP_ID=<你的-app-id>
QQBOT_APP_SECRET=<你的-app-secret>
```

**方式三：内联 `config`**（不推荐——会把密钥硬编码进配置文件）：

```yaml
config:
  appId: '<你的-app-id>'
  appSecret: '<你的-app-secret>'
```

使用方式一或二时，在 profile 的 `cordis.patch.yml` 里用 `!!js process.env.QQBOT_APP_ID ?? ''` 引用，密钥不会落盘——完整的挂载条目见上文「安装」章节。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `appId` | `$QQBOT_APP_ID` | 机器人 AppID。为空/缺失则工具不可用。 |
| `appSecret` | `$QQBOT_APP_SECRET` | 机器人 AppSecret。为空/缺失则工具不可用。 |
| `baseURL` | `https://api.bot.qq.com` | API 根地址；沙箱环境可替换。 |
| `inbound` | `false` | 启动 WebSocket 网关，从入站 QQ 消息驱动 agent。 |
| `inboundCwd` | `process.cwd()` | 入站 agent 的工作目录（绝对路径）。 |
| `inboundProvider` | （`inbound: true` 时必需） | 入站 agent 的 provider 路由（如 `deepseek-official`）。 |
| `inboundModel` | （`inbound: true` 时必需） | 入站 agent 的 model（如 `deepseek-v4-flash`）。 |
| `inboundFormat` | `markdown` | 入站回复的格式：`text` 或 `markdown`。 |

## 错误面

凭证缺失或 `content` 为空的调用会在本地被拒绝。提供方失败——HTTP 错误、网络失败、无法解析或结构不符的响应体——以 `QqBotError`（`kind: 'provider'`）抛出；被取消的请求以 `kind: 'aborted'` 抛出。HTTP 重定向在接触 `Location` 目标前就被拒绝（`redirect: 'error'`），因此重定向会以提供方错误失败。

## 模型体验

### 工具 schema

#### 模型所见

模型看到 `qq_send_message` 工具，含三个字符串参数——`channel`（`"user"` | `"group"`）、`openid`、`content`——以及可选参数 `format`（`"text"` | `"markdown"`）。

#### Token 效应

工具可见时，每次请求承担固定 schema 成本。

#### KV Cache 效应

定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使该 schema 的复用失效。

### 工具调用历史与结果

#### 模型所见

每次 assistant 工具调用在参数中保留 `channel`、`openid`、`content` 和 `format`。成功时精确返回 `QQ message sent (id <id>).`。稳定失败为 ``Error: qq_send_message requires QQBOT_APP_ID and QQBOT_APP_SECRET``、`Error: qq_send_message content must be a non-empty string`、`QQ message send aborted`，以及以 `QQ <operation> error: …` / `QQ <operation> error (HTTP <status>)` 开头的提供方失败。

#### Token 效应

Token 随模型提交的每条消息增长；调用参数会保留到压缩为止。结果本身小且结构固定。

#### KV Cache 效应

仅追加；新可见内容跟随可复用的请求前缀，不会使已有 KV-cache 条目失效。

## 已知限制与待办工作

- **无富媒体、键盘与引用回复** — 富媒体（`msg_type: 7`）、输入状态（`6`）、内置键盘与消息引用回复均未投射；仅支持文本（`0`）与 Markdown（`2`）。
- **入站会话仅存内存** — openid → session 的映射不持久化；重启会丢失对话上下文并新建会话。
- **入站重连不可恢复** — 断线后网关重新 Identify，而非 `Resume`（op 6），因此断线期间的事件会丢失。
- **入站回复拼接整轮文本** — 该轮所有文本块在 `turn/end` 时拼接为一条发出，中间工具叙述也会包含在内，超 2000 字符截断。
- **无出站限流** — QQ 的主动消息频控（未认证单聊 5 QPS / 30 QPM，群聊更高）由运营方自行负责；客户端不排队也不限速。
- **沙箱主机仅配置** — 沙箱 API 主机通过 `baseURL` 暴露，但本包未进一步集成或测试。
