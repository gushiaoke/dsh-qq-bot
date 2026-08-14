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
import { randomUUID } from 'node:crypto';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { QqBotClient, QQ_BOT_DEFAULT_BASE_URL } from "./client.js";
import { QqBotGateway } from "./gateway.js";
export { QqBotClient, QqBotError, QQ_BOT_DEFAULT_BASE_URL } from "./client.js";
export { QqBotGateway, QQ_BOT_DEFAULT_INTENTS } from "./gateway.js";
/** Cordis 插件名，供加载器诊断使用。 */
export const name = 'qq-bot';
/** 本插件注册工具依赖 tool 注册表；收消息驱动依赖 agent 工厂。 */
export const inject = ['tools', 'agents'];
/** Schemastery 配置（全可选字段）。 */
export const Config = z.object({
    appId: z.string(),
    appSecret: z.string(),
    baseURL: z.string(),
    inbound: z.boolean(),
    inboundCwd: z.string(),
    inboundProvider: z.string(),
    inboundModel: z.string(),
    inboundFormat: z.union([z.const('text'), z.const('markdown')]),
});
/** `qq_send_message` 工具的稳定描述（模型可见）。 */
const TOOL_DESCRIPTION = 'Send a message to a QQ user or group through the QQ Bot open API. '
    + '`channel` is "user" for a single chat (target = user openid) or "group" '
    + 'for a group chat (target = group openid). `format` is "text" (plain) or '
    + '"markdown" (headings, bold, lists, quotes, links). Returns the message id '
    + 'and timestamp.';
/** 单次回复的最大字符数（QQ 单条消息上限内，留余量）。 */
const MAX_REPLY_LENGTH = 2000;
/** 注册 `qq_send_message` 工具，并按需启动收消息驱动。 */
export function apply(ctx, config) {
    const client = new QqBotClient({
        // 每个环境层都可能命名该凭证：产品信任其启动环境，不涉及托管存储。
        appId: config.appId ?? launchEnvironmentOf(ctx).get('QQBOT_APP_ID')?.value ?? '',
        appSecret: config.appSecret ?? launchEnvironmentOf(ctx).get('QQBOT_APP_SECRET')?.value ?? '',
        baseURL: config.baseURL ?? QQ_BOT_DEFAULT_BASE_URL,
    });
    ctx.tools.register(defineTool({
        name: 'qq_send_message',
        description: TOOL_DESCRIPTION,
        parameters: {
            channel: {
                type: 'string',
                required: true,
                enum: ['user', 'group'],
                description: 'Target session: "user" for single chat, "group" for group chat.',
            },
            openid: {
                type: 'string',
                required: true,
                description: 'Target user openid (channel=user) or group openid (channel=group).',
            },
            content: {
                type: 'string',
                required: true,
                description: 'The message to send (non-empty).',
            },
            format: {
                type: 'string',
                enum: ['text', 'markdown'],
                description: 'Message format: "text" (plain) or "markdown". Defaults to "text".',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', required: true },
                    timestamp: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `QQ message sent (id ${value.id}).`,
                }],
        },
        execute(args, exec) {
            if (!client.configured()) {
                throw new Error('qq_send_message requires QQBOT_APP_ID and QQBOT_APP_SECRET');
            }
            if (args.content.trim().length === 0) {
                throw new Error('qq_send_message content must be a non-empty string');
            }
            return client.sendMessage(args.channel, args.openid, args.content, exec.signal, undefined, args.format ?? 'text');
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Send QQ message',
            kind: 'other',
            rawInput: { channel: args.channel, openid: args.openid, content: args.content, format: args.format ?? 'text' },
        }),
    }));
    if (config.inbound === true) {
        if (!client.configured()) {
            ctx.logger.warn('inbound requested but QQBOT_APP_ID / QQBOT_APP_SECRET are missing; inbound disabled');
            return;
        }
        if (config.inboundProvider === undefined || config.inboundModel === undefined) {
            throw new Error('qq-bot: inbound requires inboundProvider and inboundModel '
                + '(the model route that answers inbound QQ messages)');
        }
        startInbound(ctx, client, config);
    }
}
/** 启动 WebSocket 收消息驱动：连接网关，把入站消息灌入 agent 并回推回复。 */
function startInbound(ctx, client, config) {
    const logger = ctx.logger;
    const agents = ctx.agents;
    const cwd = config.inboundCwd ?? process.cwd();
    const replyFormat = config.inboundFormat ?? 'markdown';
    const agentOptions = {
        ...config.inboundProvider !== undefined ? { provider: config.inboundProvider } : {},
        ...config.inboundModel !== undefined ? { model: config.inboundModel } : {},
    };
    const bySession = new Map();
    const byKey = new Map();
    const gateway = new QqBotGateway({
        client,
        onMessage: (data, eventType) => { void handleInbound(data, eventType); },
        logger,
    });
    async function handleInbound(data, eventType) {
        const parsed = parseInbound(data, eventType);
        if (parsed === undefined)
            return;
        const key = `${parsed.channel}:${parsed.openid}`;
        const existingId = byKey.get(key);
        const existing = existingId !== undefined ? bySession.get(existingId) : undefined;
        if (existing !== undefined) {
            existing.pendingMsgId = parsed.msgId;
            existing.chunks = [];
            existing.record.agent.followup(userMessage(parsed.content));
            return;
        }
        try {
            const sessionId = SessionId(randomUUID());
            const handle = await agents.create({ sessionId, meta: { cwd }, agentOptions });
            const state = {
                record: {
                    agent: handle.agent,
                    dispose: () => handle.dispose(),
                    channel: parsed.channel,
                    openid: parsed.openid,
                },
                pendingMsgId: parsed.msgId,
                chunks: [],
            };
            bySession.set(sessionId, state);
            byKey.set(key, sessionId);
            state.record.agent.followup(userMessage(parsed.content));
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger.warn(`failed to create agent: ${detail}`);
        }
    }
    // 把本插件创建的 agent 的最终回复回推给 QQ 发送者。
    ctx.on('session/event', (session, event) => {
        const state = bySession.get(session.header.id);
        if (state === undefined)
            return;
        if (event.type === 'assistant/message') {
            for (const block of event.data.message.content) {
                if (block.type === 'text' && block.text.length > 0)
                    state.chunks.push(block.text);
            }
            return;
        }
        if (event.type === 'turn/end') {
            const text = state.chunks.join('\n').trim();
            state.chunks = [];
            const msgId = state.pendingMsgId;
            state.pendingMsgId = undefined;
            if (text === '')
                return;
            const reply = text.length > MAX_REPLY_LENGTH ? `${text.slice(0, MAX_REPLY_LENGTH)}…` : text;
            void client.sendMessage(state.record.channel, state.record.openid, reply, undefined, msgId, replyFormat)
                .catch((error) => {
                const detail = error instanceof Error ? error.message : String(error);
                logger.warn(`reply failed: ${detail}`);
            });
        }
    });
    // 卸载时关闭网关并处置所有收消息 agent。
    ctx.effect(() => () => {
        gateway.stop();
        for (const state of bySession.values())
            void state.record.dispose();
    });
    void gateway.start();
}
/** 构造一条 user 消息（内容 + 来源）。 */
function userMessage(content) {
    return createUserMessage({
        content: [{ type: 'text', text: content }],
        source: { kind: 'user' },
    });
}
/** 从入站事件解析出回复目标与文本；无法解析或空文本时返回 undefined。 */
function parseInbound(data, eventType) {
    const content = (data.content ?? '').trim();
    if (content === '')
        return undefined;
    if (eventType === 'C2C_MESSAGE_CREATE') {
        const openid = data.author?.user_openid ?? '';
        if (openid === '')
            return undefined;
        return { channel: 'user', openid, content, msgId: data.id };
    }
    if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
        const openid = data.group_openid ?? '';
        if (openid === '')
            return undefined;
        return { channel: 'group', openid, content, msgId: data.id };
    }
    return undefined;
}
//# sourceMappingURL=index.js.map