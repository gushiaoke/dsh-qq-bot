/**
 * Wire types for the QQ Bot open API (`https://api.bot.qq.com`). Types only —
 * no runtime code.
 * @module dsh-qq-bot/types
 */

/** 消息目标会话类型：单聊（用户 openid）或群聊（群 openid）。 */
export type QqBotChannel = 'user' | 'group'

/**
 * 消息格式：`text`（纯文本，`msg_type=0`）或 `markdown`（`msg_type=2`）。
 * Markdown 支持标题、加粗/斜体/删除线、链接、图片、列表、引用与分割线。
 */
export type QqBotMessageFormat = 'text' | 'markdown'

/** 换取 Access Token 的成功响应。 */
export interface QqBotAccessTokenResponse {
  access_token: string
  /** 有效期（秒），官方为 7200（2 小时）。 */
  expires_in: number
}

/** 发送消息的成功响应。 */
export interface QqBotSendMessageResponse {
  /** 消息 ID，可用于后续撤回。 */
  id: string
  /** 发送时间（RFC3339 东八区）。 */
  timestamp: string
  /** 扩展信息（引用消息索引等），通常不存在。 */
  ext_info?: { ref_idx: string }
}

/** QQ Bot API 的错误响应（best-effort，字段随失败类型变化）。 */
export interface QqBotErrorResponse {
  message?: string
  code?: number
}

/** 获取网关地址的成功响应（`GET /gateway/bot`）。 */
export interface QqBotGatewayResponse {
  /** WebSocket 网关地址（如 `wss://api.sgroup.qq.com/websocket`）。 */
  url: string
  /** 建议分片数。 */
  shards?: number
}

/** WebSocket 事件帧：op/s/t/id/d。 */
export interface QqBotWsFrame {
  /** 操作码：0=Dispatch、1=心跳、2=Identify、6=Resume、7=Reconnect、9=Invalid Session、10=Hello、11=Heartbeat ACK。 */
  op: number
  /** 序列号，用于心跳与 Resume。 */
  s?: number
  /** 事件名（Dispatch 时，如 `C2C_MESSAGE_CREATE`）。 */
  t?: string
  /** 事件 ID。 */
  id?: string
  /** 事件数据体。 */
  d?: unknown
}

/** 消息事件（C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE）的发送者。 */
export interface QqBotMessageAuthor {
  /** 用户 OpenID（单聊场景）。 */
  user_openid?: string
  /** 群成员 OpenID（群聊场景）。 */
  member_openid?: string
}

/** 消息事件（C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE）的数据体。 */
export interface QqBotMessageEventData {
  /** 消息 ID，可用于被动回复的 `msg_id`。 */
  id: string
  /** 发送者。 */
  author?: QqBotMessageAuthor
  /** 消息文本内容（群聊 @ 机器人事件已去除 @ 前缀）。 */
  content?: string
  /** 群 OpenID（仅群聊事件）。 */
  group_openid?: string
  /** 发送时间（RFC3339）。 */
  timestamp?: string
}
