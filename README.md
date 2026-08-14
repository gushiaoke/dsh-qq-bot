# dsh-qq-bot

English | [中文](README.zh.md)

The model-facing `qq_send_message` tool pushes a text message to a QQ single-chat user or group through the [QQ Bot open API](https://bot.q.qq.com) (`api.bot.qq.com`). With `inbound: true` it also drives agents from inbound QQ messages over the WebSocket gateway. It is an **implementation** package — it registers one tool into `ctx.tools`, it does not own `ctx.tools` and registers no service key.

## What it does

Registers `qq_send_message(channel, openid, content, format?)` on `ctx.tools`. `channel` is `"user"` for a single chat (target = user openid) or `"group"` for a group chat (target = group openid). `format` is `"text"` (default) or `"markdown"`. A call obtains an Access Token (`POST /app/getAppAccessToken` with AppID/AppSecret) and sends the message (`POST /v2/users/{openid}/messages` or `/v2/groups/{openid}/messages`, `Authorization: QQBot <access_token>`; body `{ content, msg_type: 0 }` for text, `{ markdown: { content }, msg_type: 2 }` for Markdown).

The Access Token lives 2 hours; `QqBotClient` caches it and refreshes within a 60-second window before expiry. Markdown supports QQ's documented subset — headings, bold/italic/strikethrough, links, images (public URL), ordered/unordered lists, blockquotes, and horizontal rules; code blocks and tables are not in the documented set. Media and inline keyboard are not projected by this tool.

With `inbound: true`, the package starts an outbound WebSocket gateway connection (`QqBotGateway`). It maps each QQ single chat / group to a dedicated agent session, feeds inbound `C2C_MESSAGE_CREATE` / `GROUP_AT_MESSAGE_CREATE` text through `followup`, and replies the turn's committed assistant text back to the sender. Authentication uses the same AppID/AppSecret — Identify `token` is `QQBot <access_token>` with intents `1 << 25` — and needs no public callback address because the gateway is an outbound connection.

## Installation

Prerequisites: a `dsh` installation with the `dsh` CLI on `PATH`, plus a profile whose bundles provide the `ctx.tools` and `ctx.agents` services (`@deepseek-ai/dsh-base` provides both; `dsh plugin` initializes it as the default bundle on first use).

1. Add the plugin to a profile:

```sh
dsh plugin --profile <name> add github:gushiaoke/dsh-qq-bot
```

2. Mount it by appending an `insert` entry to the profile's patch layer `~/.dsh/profiles/<name>/cordis.patch.yml`:

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

3. Supply the credentials (see Credentials below) and start:

```sh
dsh --profile <name>
```

## Credentials (AppID + AppSecret)

Create a bot at the [QQ Bot developer console](https://q.qq.com/#/apps) and copy its **AppID** (bot id) and **AppSecret** (client secret). The legacy `Token` credential is deprecated and not used.

Supply them one of three ways, in order of precedence (environment > project `.env` > harness-home `.env`):

**1. Environment variables** (recommended for production):

```bash
export QQBOT_APP_ID="<your-app-id>"
export QQBOT_APP_SECRET="<your-app-secret>"
```

```powershell
$env:QQBOT_APP_ID = "<your-app-id>"
$env:QQBOT_APP_SECRET = "<your-app-secret>"
```

**2. A `.env` file** in the invoking directory or `~/.dsh/.env`:

```
QQBOT_APP_ID=<your-app-id>
QQBOT_APP_SECRET=<your-app-secret>
```

**3. Inline `config`** (discouraged — it hard-codes the secret into a config file):

```yaml
config:
  appId: '<your-app-id>'
  appSecret: '<your-app-secret>'
```

When using options 1 or 2, reference the credentials from the profile's `cordis.patch.yml` with `!!js process.env.QQBOT_APP_ID ?? ''` so the secret never lands on disk — the full mount entry is shown under Installation above.

## Config

| Key | Default | Meaning |
|---|---|---|
| `appId` | `$QQBOT_APP_ID` | Bot AppID. Empty/absent makes the tool unavailable. |
| `appSecret` | `$QQBOT_APP_SECRET` | Bot AppSecret. Empty/absent makes the tool unavailable. |
| `baseURL` | `https://api.bot.qq.com` | Endpoint base; the sandbox host may replace it. |
| `inbound` | `false` | Start the WebSocket gateway and drive agents from inbound QQ messages. |
| `inboundCwd` | `process.cwd()` | Absolute working directory for inbound-created agents. |
| `inboundProvider` | (required when `inbound: true`) | Provider route for inbound-created agents (e.g. `deepseek-official`). |
| `inboundModel` | (required when `inbound: true`) | Model for inbound-created agents (e.g. `deepseek-v4-flash`). |
| `inboundFormat` | `markdown` | Reply format for inbound turns: `text` or `markdown`. |

## Error surface

A call whose credentials are absent or whose `content` is blank is rejected locally. Provider failures — HTTP errors, network failure, unparseable or wrong-shape bodies — surface as `QqBotError` with `kind: 'provider'`; an aborted request surfaces as `kind: 'aborted'`. HTTP redirects are rejected before the `Location` target is contacted (`redirect: 'error'`), so a redirect fails as a provider error.

## Model Experience

### Tool schema

#### What the model sees

The model sees the `qq_send_message` tool with three string parameters — `channel` (`"user"` | `"group"`), `openid`, `content` — plus an optional `format` (`"text"` | `"markdown"`).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains `channel`, `openid`, `content`, and `format` in its arguments. Success returns exactly `QQ message sent (id <id>).` Stable failures are ``Error: qq_send_message requires QQBOT_APP_ID and QQBOT_APP_SECRET``, `Error: qq_send_message content must be a non-empty string`, `QQ message send aborted`, and provider failures prefixed `QQ <operation> error: …` / `QQ <operation> error (HTTP <status>)`.

#### Token effect

Token growth scales with every message the model submits; call arguments remain until compaction. The result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No media, keyboard, or reference replies** — rich media (`msg_type: 7`), input-state (`6`), inline keyboards, and message-reference replies are not projected; only text (`0`) and Markdown (`2`) are.
- **Inbound sessions are in-memory** — the openid → session mapping is not persisted; a restart drops conversation context and mints fresh sessions.
- **Inbound reconnect is not resumable** — the gateway re-identifies on disconnect instead of `Resume` (op 6), so events during a gap are dropped.
- **Inbound reply concatenates whole-turn text** — every text block across the turn is joined and sent once at `turn/end`; intermediate tool narration is included, truncated at 2000 characters.
- **No outbound rate limiting** — QQ's active-message frequency limits (unverified 5 QPS / 30 QPM for direct messages, higher for groups) are the operator's responsibility; the client does not queue or throttle.
- **Sandbox host is config-only** — the sandbox API host is exposed through `baseURL` but is not otherwise integrated or tested here.
