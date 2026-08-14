/**
 * `QqBotGateway`: a minimal QQ Bot WebSocket gateway client. It resolves the
 * gateway endpoint through the open API, connects out (no public callback
 * address required), authenticates with an Access Token (`QQBot <token>`), and
 * keeps the connection alive with heartbeats. Inbound message events are
 * dispatched through a callback.
 *
 * @module dsh-qq-bot/gateway
 */

import WebSocket from 'ws'
import type { QqBotClient } from './client.ts'
import type { QqBotMessageEventData, QqBotWsFrame } from './types.ts'

/** WebSocket OpCode 常量。 */
const OP_DISPATCH = 0
const OP_HEARTBEAT = 1
const OP_IDENTIFY = 2
const OP_RECONNECT = 7
const OP_INVALID_SESSION = 9
const OP_HELLO = 10
const OP_HEARTBEAT_ACK = 11

/** 默认订阅：`GROUP_AND_C2C_EVENT`（单聊 + 群聊 @ 机器人）。 */
export const QQ_BOT_DEFAULT_INTENTS = 1 << 25

/** 断线重连前的等待（毫秒）。 */
const RECONNECT_DELAY_MS = 3000

/** 网关连接日志器（兼容 Cordis logger 的 info/warn/error 接口）。 */
export interface QqBotGatewayLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** 网关客户端选项。 */
export interface QqBotGatewayOptions {
  /** 已配置凭证的 QQ Bot 客户端（用于换 token 和拿网关地址）。 */
  client: QqBotClient
  /** 订阅的事件位掩码；缺省为 {@link QQ_BOT_DEFAULT_INTENTS}。 */
  intents?: number
  /** 入站消息回调（C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE）。 */
  onMessage: (event: QqBotMessageEventData, eventType: string) => void
  /** 日志器。 */
  logger: QqBotGatewayLogger
}

/**
 * WebSocket 出站长连接客户端：连接、鉴权、心跳、重连与入站事件分发。
 * 断线后简单重连并重新 Identify（不 Resume，丢事件换取实现简单）。
 */
export class QqBotGateway {
  private readonly client: QqBotClient
  private readonly intents: number
  private readonly onMessage: (event: QqBotMessageEventData, eventType: string) => void
  private readonly logger: QqBotGatewayLogger
  private ws: WebSocket | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private heartbeatInterval = 45_000
  private seq: number | null = null
  private stopped: boolean = false

  constructor(options: QqBotGatewayOptions) {
    this.client = options.client
    this.intents = options.intents ?? QQ_BOT_DEFAULT_INTENTS
    this.onMessage = options.onMessage
    this.logger = options.logger
  }

  /** 连接网关并开始收发。异步：换 token → 拿网关 → 连接 → 鉴权。 */
  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  /** 关闭连接并停止心跳。 */
  stop(): void {
    this.stopped = true
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = undefined
    if (ws !== undefined) {
      ws.removeAllListeners()
      ws.close()
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    try {
      const url = await this.client.gatewayUrl()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- stop() may run while the gateway request is awaited.
      if (this.stopped) return
      const ws = new WebSocket(url)
      this.ws = ws
      ws.on('open', () => { this.logger.info('gateway connected') })
      ws.on('message', (data: WebSocket.RawData) => { this.handleFrame(data) })
      ws.on('error', (error: Error) => { this.logger.warn(`gateway error: ${error.message}`) })
      ws.on('close', (code: number) => {
        this.stopHeartbeat()
        if (this.stopped) return
        this.logger.warn(`gateway closed (${code}), reconnecting`)
        setTimeout(() => { void this.connect() }, RECONNECT_DELAY_MS)
      })
    } catch (error: unknown) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- stop() may run while the gateway request is awaited.
      if (this.stopped) return
      const detail = error instanceof Error ? error.message : String(error)
      this.logger.warn(`gateway connect failed: ${detail}`)
      setTimeout(() => { void this.connect() }, RECONNECT_DELAY_MS)
    }
  }

  private handleFrame(data: WebSocket.RawData): void {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf8')
        : data.toString('utf8')
    let frame: QqBotWsFrame
    try {
      frame = JSON.parse(text) as QqBotWsFrame
    } catch {
      this.logger.warn('gateway sent a non-JSON frame')
      return
    }

    switch (frame.op) {
      case OP_HELLO: {
        const interval = (frame.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval
        if (interval !== undefined) this.heartbeatInterval = interval
        void this.identify()
        break
      }
      case OP_DISPATCH: {
        if (frame.s !== undefined) this.seq = frame.s
        if (frame.t === 'READY') this.startHeartbeat()
        else this.dispatch(frame)
        break
      }
      case OP_RECONNECT:
      case OP_INVALID_SESSION:
        this.logger.warn(`gateway requested reconnect (op=${frame.op})`)
        this.restart()
        break
      case OP_HEARTBEAT_ACK:
        break
      default:
        break
    }
  }

  private async identify(): Promise<void> {
    const ws = this.ws
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) return
    try {
      const token = await this.client.accessToken()
      ws.send(JSON.stringify({
        op: OP_IDENTIFY,
        d: {
          token: `QQBot ${token}`,
          intents: this.intents,
          shard: [0, 1],
          properties: { $os: 'linux', $browser: 'dsh', $device: 'dsh' },
        },
      }))
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      this.logger.warn(`identify failed: ${detail}`)
    }
  }

  private dispatch(frame: QqBotWsFrame): void {
    const eventType = frame.t
    if (eventType !== 'C2C_MESSAGE_CREATE' && eventType !== 'GROUP_AT_MESSAGE_CREATE') return
    const data = frame.d as QqBotMessageEventData | undefined
    if (data === undefined) return
    try {
      this.onMessage(data, eventType)
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      this.logger.warn(`inbound handler failed: ${detail}`)
    }
  }

  private restart(): void {
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = undefined
    if (ws !== undefined) {
      ws.removeAllListeners()
      ws.close()
    }
    setTimeout(() => { void this.connect() }, RECONNECT_DELAY_MS)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.seq }))
      }
    }, this.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }
}
