/**
 * `dsh-qq-bot`: registers the model-facing `qq_send_message`
 * tool that pushes a text message to a QQ single-chat user or group through the
 * QQ Bot open API, and optionally drives agents from inbound QQ messages over
 * the WebSocket gateway.
 *
 * Credentials come from the launch environment (`QQBOT_APP_ID` /
 * `QQBOT_APP_SECRET`) with optional Config overrides; the `QqBotClient` caches
 * the 2-hour Access Token and refreshes it within a 60-second window.
 *
 * Inbound mode (`config.inbound === true`) starts an outbound WebSocket gateway
 * connection (no public callback address required), maps each QQ single chat /
 * group to a dedicated agent session, feeds inbound text through `followup`,
 * and replies the turn's committed assistant text back to the sender.
 *
 * @module dsh-qq-bot
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { QqBotMessageFormat } from './types.ts';
export { QqBotClient, QqBotError, QQ_BOT_DEFAULT_BASE_URL } from './client.ts';
export { QqBotGateway, QQ_BOT_DEFAULT_INTENTS } from './gateway.ts';
export type { QqBotAccessTokenResponse, QqBotChannel, QqBotGatewayResponse, QqBotMessageEventData, QqBotMessageFormat, QqBotSendMessageResponse, } from './types.ts';
/** Cordis 插件名，供加载器诊断使用。 */
export declare const name = "qq-bot";
/** 本插件注册工具依赖 tool 注册表；收消息驱动依赖 agent 工厂。 */
export declare const inject: string[];
/** QQ Bot 插件配置（全部可选，`apply` 用环境变量补齐默认值）。 */
export interface Config {
    /** 机器人 AppID。缺省回退到 `$QQBOT_APP_ID`。空 → 工具不可用。 */
    appId?: string;
    /** 机器人 AppSecret。缺省回退到 `$QQBOT_APP_SECRET`。空 → 工具不可用。 */
    appSecret?: string;
    /** API 根地址；默认公开 API。 */
    baseURL?: string;
    /** 是否启动 WebSocket 收消息驱动（默认关闭）。 */
    inbound?: boolean;
    /** 收消息 agent 的工作目录（绝对路径）；缺省为进程 cwd。 */
    inboundCwd?: string;
    /** 收消息 agent 的 provider 路由。 */
    inboundProvider?: string;
    /** 收消息 agent 的 model。 */
    inboundModel?: string;
    /** 入站回复的消息格式：`text` 或 `markdown`（默认 `markdown`，渲染 agent 的 Markdown 输出）。 */
    inboundFormat?: QqBotMessageFormat;
}
/** Schemastery 配置（全可选字段）。 */
export declare const Config: z<Config>;
/** 注册 `qq_send_message` 工具，并按需启动收消息驱动。 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map