/**
 * `QqBotClient`: a minimal QQ Bot open-API client that obtains and caches an
 * Access Token (`POST /app/getAppAccessToken` with the AppID/AppSecret) and
 * sends a text message to a single-chat user or a group
 * (`POST /v2/users/{openid}/messages` / `POST /v2/groups/{openid}/messages`
 * with `Authorization: QQBot <access_token>`).
 * @module dsh-qq-bot/client
 */
import type { QqBotChannel, QqBotMessageFormat, QqBotSendMessageResponse } from './types.ts';
/** 默认 QQ Bot 开放平台 API 根地址。 */
export declare const QQ_BOT_DEFAULT_BASE_URL = "https://api.bot.qq.com";
/** 客户端选项：凭证与端点。 */
export interface QqBotClientOptions {
    /** 机器人 AppID。 */
    appId: string;
    /** 机器人 AppSecret。 */
    appSecret: string;
    /** API 根地址；测试时指向沙箱。 */
    baseURL?: string;
}
/** QQ Bot 客户端：负责 Access Token 的换取/缓存与文本消息发送。 */
export declare class QqBotClient {
    private readonly appId;
    private readonly appSecret;
    private readonly baseURL;
    private cached;
    constructor(options: QqBotClientOptions);
    /** 凭证是否齐全（两者均非空）。空/缺失使客户端不可用。 */
    configured(): boolean;
    /**
     * 换取（或复用缓存中未过期的）Access Token。
     * @param signal - 取消信号；换取被取消时抛出 `QqBotError`（aborted）。
     * @returns 当前有效的 Access Token。
     */
    accessToken(signal?: AbortSignal): Promise<string>;
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
    sendMessage(channel: QqBotChannel, openid: string, content: string, signal?: AbortSignal, msgId?: string, format?: QqBotMessageFormat): Promise<QqBotSendMessageResponse>;
    /**
     * 获取 WebSocket 网关地址（`GET /gateway/bot`）。
     * @param signal - 取消信号。
     * @returns 网关 WebSocket URL（如 `wss://api.sgroup.qq.com/websocket`）。
     */
    gatewayUrl(signal?: AbortSignal): Promise<string>;
}
/** QQ Bot 客户端错误：区分「已取消」与「提供方失败」。 */
export declare class QqBotError extends Error {
    /** 错误类别：`aborted`（调用方取消）或 `provider`（HTTP/网络/解析失败）。 */
    readonly kind: 'aborted' | 'provider';
    constructor(message: string, kind: 'aborted' | 'provider', options?: ErrorOptions);
}
//# sourceMappingURL=client.d.ts.map