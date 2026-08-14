/**
 * `QqBotGateway`: a minimal QQ Bot WebSocket gateway client. It resolves the
 * gateway endpoint through the open API, connects out (no public callback
 * address required), authenticates with an Access Token (`QQBot <token>`), and
 * keeps the connection alive with heartbeats. Inbound message events are
 * dispatched through a callback.
 *
 * @module dsh-qq-bot/gateway
 */
import type { QqBotClient } from './client.ts';
import type { QqBotMessageEventData } from './types.ts';
/** 默认订阅：`GROUP_AND_C2C_EVENT`（单聊 + 群聊 @ 机器人）。 */
export declare const QQ_BOT_DEFAULT_INTENTS: number;
/** 网关连接日志器（兼容 Cordis logger 的 info/warn/error 接口）。 */
export interface QqBotGatewayLogger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
/** 网关客户端选项。 */
export interface QqBotGatewayOptions {
    /** 已配置凭证的 QQ Bot 客户端（用于换 token 和拿网关地址）。 */
    client: QqBotClient;
    /** 订阅的事件位掩码；缺省为 {@link QQ_BOT_DEFAULT_INTENTS}。 */
    intents?: number;
    /** 入站消息回调（C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE）。 */
    onMessage: (event: QqBotMessageEventData, eventType: string) => void;
    /** 日志器。 */
    logger: QqBotGatewayLogger;
}
/**
 * WebSocket 出站长连接客户端：连接、鉴权、心跳、重连与入站事件分发。
 * 断线后简单重连并重新 Identify（不 Resume，丢事件换取实现简单）。
 */
export declare class QqBotGateway {
    private readonly client;
    private readonly intents;
    private readonly onMessage;
    private readonly logger;
    private ws;
    private heartbeatTimer;
    private heartbeatInterval;
    private seq;
    private stopped;
    constructor(options: QqBotGatewayOptions);
    /** 连接网关并开始收发。异步：换 token → 拿网关 → 连接 → 鉴权。 */
    start(): Promise<void>;
    /** 关闭连接并停止心跳。 */
    stop(): void;
    private connect;
    private handleFrame;
    private identify;
    private dispatch;
    private restart;
    private startHeartbeat;
    private stopHeartbeat;
}
//# sourceMappingURL=gateway.d.ts.map