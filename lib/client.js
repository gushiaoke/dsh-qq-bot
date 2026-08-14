/**
 * `QqBotClient`: a minimal QQ Bot open-API client that obtains and caches an
 * Access Token (`POST /app/getAppAccessToken` with the AppID/AppSecret) and
 * sends a text message to a single-chat user or a group
 * (`POST /v2/users/{openid}/messages` / `POST /v2/groups/{openid}/messages`
 * with `Authorization: QQBot <access_token>`).
 * @module dsh-qq-bot/client
 */
/** 默认 QQ Bot 开放平台 API 根地址。 */
export const QQ_BOT_DEFAULT_BASE_URL = 'https://api.bot.qq.com';
/** 消息类型：0=纯文本（content），2=Markdown（markdown.content）。 */
const MSG_TYPE_TEXT = 0;
const MSG_TYPE_MARKDOWN = 2;
/** 提前刷新的安全窗口：到期前 60 秒内视为已过期。 */
const REFRESH_WINDOW_MS = 60_000;
/** QQ Bot 客户端：负责 Access Token 的换取/缓存与文本消息发送。 */
export class QqBotClient {
    appId;
    appSecret;
    baseURL;
    cached;
    constructor(options) {
        this.appId = options.appId;
        this.appSecret = options.appSecret;
        this.baseURL = options.baseURL ?? QQ_BOT_DEFAULT_BASE_URL;
    }
    /** 凭证是否齐全（两者均非空）。空/缺失使客户端不可用。 */
    configured() {
        return this.appId.length > 0 && this.appSecret.length > 0;
    }
    /**
     * 换取（或复用缓存中未过期的）Access Token。
     * @param signal - 取消信号；换取被取消时抛出 `QqBotError`（aborted）。
     * @returns 当前有效的 Access Token。
     */
    async accessToken(signal) {
        const now = Date.now();
        const cached = this.cached;
        if (cached !== undefined && now < cached.expiresAt - REFRESH_WINDOW_MS) {
            return cached.value;
        }
        let response;
        try {
            response = await fetch(`${this.baseURL}/app/getAppAccessToken`, {
                method: 'POST',
                redirect: 'error',
                headers: {
                    'content-type': 'application/json',
                    'accept': 'application/json',
                },
                body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
                ...signal !== undefined ? { signal } : {},
            });
        }
        catch (error) {
            if (isAbortError(error))
                throw new QqBotError('QQ access token request aborted', 'aborted', { cause: error });
            throw new QqBotError(`QQ access token request failed: ${String(error)}`, 'provider', { cause: error });
        }
        if (!response.ok) {
            throw new QqBotError(await readErrorMessage(response, 'access token'), 'provider');
        }
        try {
            const payload = await response.json();
            this.cached = {
                value: payload.access_token,
                expiresAt: now + payload.expires_in * 1000,
            };
            return payload.access_token;
        }
        catch (error) {
            if (isAbortError(error))
                throw new QqBotError('QQ access token request aborted', 'aborted', { cause: error });
            throw new QqBotError(`QQ returned an unprocessable access-token body: ${String(error)}`, 'provider', { cause: error });
        }
    }
    /**
     * 向一个单聊用户或群发送消息。
     * @param channel - `user`（单聊）或 `group`（群聊）。
     * @param openid - 目标用户 openid（单聊）或群 openid（群聊）。
     * @param content - 消息内容（非空）。
     * @param signal - 取消信号。
     * @param msgId - 被动回复的消息 ID（回应用户消息时传入，5 分钟有效）。
     * @param format - 消息格式，`text`（默认）或 `markdown`。
     * @returns 发送成功后的消息 ID 与时间戳。
     */
    async sendMessage(channel, openid, content, signal, msgId, format = 'text') {
        const token = await this.accessToken(signal);
        const target = channel === 'group'
            ? `/v2/groups/${encodeURIComponent(openid)}/messages`
            : `/v2/users/${encodeURIComponent(openid)}/messages`;
        // QQ 要求 text 与 markdown 二选一：text 用 content 字段，markdown 用 markdown.content。
        const payload = format === 'markdown'
            ? { markdown: { content }, msg_type: MSG_TYPE_MARKDOWN }
            : { content, msg_type: MSG_TYPE_TEXT };
        let response;
        try {
            response = await fetch(`${this.baseURL}${target}`, {
                method: 'POST',
                redirect: 'error',
                headers: {
                    'authorization': `QQBot ${token}`,
                    'content-type': 'application/json',
                    'accept': 'application/json',
                },
                body: JSON.stringify({
                    ...payload,
                    ...(msgId !== undefined ? { msg_id: msgId } : {}),
                }),
                ...signal !== undefined ? { signal } : {},
            });
        }
        catch (error) {
            if (isAbortError(error))
                throw new QqBotError('QQ message send aborted', 'aborted', { cause: error });
            throw new QqBotError(`QQ message send failed: ${String(error)}`, 'provider', { cause: error });
        }
        if (!response.ok) {
            throw new QqBotError(await readErrorMessage(response, 'message send'), 'provider');
        }
        try {
            return await response.json();
        }
        catch (error) {
            if (isAbortError(error))
                throw new QqBotError('QQ message send aborted', 'aborted', { cause: error });
            throw new QqBotError(`QQ returned an unprocessable message body: ${String(error)}`, 'provider', { cause: error });
        }
    }
    /**
     * 获取 WebSocket 网关地址（`GET /gateway/bot`）。
     * @param signal - 取消信号。
     * @returns 网关 WebSocket URL（如 `wss://api.sgroup.qq.com/websocket`）。
     */
    async gatewayUrl(signal) {
        const token = await this.accessToken(signal);
        let response;
        try {
            response = await fetch(`${this.baseURL}/gateway/bot`, {
                redirect: 'error',
                headers: {
                    'authorization': `QQBot ${token}`,
                    'accept': 'application/json',
                },
                ...signal !== undefined ? { signal } : {},
            });
        }
        catch (error) {
            if (isAbortError(error))
                throw new QqBotError('QQ gateway request aborted', 'aborted', { cause: error });
            throw new QqBotError(`QQ gateway request failed: ${String(error)}`, 'provider', { cause: error });
        }
        if (!response.ok) {
            throw new QqBotError(await readErrorMessage(response, 'gateway'), 'provider');
        }
        try {
            const payload = await response.json();
            return payload.url;
        }
        catch (error) {
            if (isAbortError(error))
                throw new QqBotError('QQ gateway request aborted', 'aborted', { cause: error });
            throw new QqBotError(`QQ returned an unprocessable gateway body: ${String(error)}`, 'provider', { cause: error });
        }
    }
}
/** QQ Bot 客户端错误：区分「已取消」与「提供方失败」。 */
export class QqBotError extends Error {
    /** 错误类别：`aborted`（调用方取消）或 `provider`（HTTP/网络/解析失败）。 */
    kind;
    constructor(message, kind, options) {
        super(message, options);
        this.name = 'QqBotError';
        this.kind = kind;
    }
}
/** 从非 2xx 响应尽力提取错误文本，回退到 HTTP 状态码。 */
async function readErrorMessage(response, operation) {
    const status = response.status;
    try {
        const payload = await response.json();
        const detail = payload.message;
        if (detail !== undefined && detail.length > 0)
            return `QQ ${operation} error: ${detail}`;
    }
    catch (error) {
        if (isAbortError(error))
            return `QQ ${operation} aborted`;
        // 非 JSON 错误体（网关 5xx/429 常见）：状态码已足够，不求更富文本。
    }
    return `QQ ${operation} error (HTTP ${status})`;
}
/** 判断是否为 fetch/`AbortSignal` 取消错误。 */
function isAbortError(error) {
    return error instanceof DOMException && error.name === 'AbortError';
}
//# sourceMappingURL=client.js.map