import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QQ_BOT_DEFAULT_BASE_URL, QqBotClient, QqBotError } from '../src/client.ts'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 构造一个换 token 响应 + 一个业务响应，返回 mock 调用序列。 */
function stubTokenThen(body: unknown) {
  mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }))
  mockFetch.mockResolvedValueOnce(jsonResponse(body))
}

function newClient(): QqBotClient {
  return new QqBotClient({ appId: 'app-1', appSecret: 'secret-1' })
}

describe('QqBotClient', () => {
  describe('configured', () => {
    it('is true when both credentials are non-empty', () => {
      expect(newClient().configured()).toBe(true)
    })

    it('is false when appId or appSecret is empty', () => {
      expect(new QqBotClient({ appId: '', appSecret: 's' }).configured()).toBe(false)
      expect(new QqBotClient({ appId: 'a', appSecret: '' }).configured()).toBe(false)
    })
  })

  describe('accessToken', () => {
    it('caches the token and reuses it on a second call', async () => {
      const client = newClient()
      mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }))
      const first = await client.accessToken()
      const second = await client.accessToken()
      expect(first).toBe('tok-1')
      expect(second).toBe('tok-1')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('refreshes when the cached token has expired', async () => {
      const client = newClient()
      // expires_in: 0 使 token 立即过期，第二次调用必须重新请求。
      mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 0 }))
      await client.accessToken()
      mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-2', expires_in: 7200 }))
      const second = await client.accessToken()
      expect(second).toBe('tok-2')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws QqBotError when the token endpoint fails', async () => {
      const client = newClient()
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'bad secret' }, 400))
      await expect(client.accessToken()).rejects.toBeInstanceOf(QqBotError)
    })
  })

  describe('sendMessage', () => {
    it('sends a text message (content + msg_type=0) to a single-chat user', async () => {
      const client = newClient()
      stubTokenThen({ id: 'msg-1', timestamp: '2026-01-01T00:00:00+08:00' })
      const result = await client.sendMessage('user', 'openid-1', 'hello')

      expect(result.id).toBe('msg-1')
      const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(url).toBe(`${QQ_BOT_DEFAULT_BASE_URL}/v2/users/openid-1/messages`)
      expect(JSON.parse(init.body as string)).toEqual({ content: 'hello', msg_type: 0 })
    })

    it('sends to a group when channel=group', async () => {
      const client = newClient()
      stubTokenThen({ id: 'msg-2', timestamp: 't' })
      await client.sendMessage('group', 'group-1', 'hi')
      const [url] = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(url).toBe(`${QQ_BOT_DEFAULT_BASE_URL}/v2/groups/group-1/messages`)
    })

    it('sends a markdown message (markdown.content + msg_type=2)', async () => {
      const client = newClient()
      stubTokenThen({ id: 'msg-3', timestamp: 't' })
      await client.sendMessage('user', 'openid-1', '# hi\n**bold**', undefined, undefined, 'markdown')

      const [, init] = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        markdown: { content: '# hi\n**bold**' },
        msg_type: 2,
      })
    })

    it('includes msg_id for a passive reply', async () => {
      const client = newClient()
      stubTokenThen({ id: 'msg-4', timestamp: 't' })
      await client.sendMessage('user', 'openid-1', 'reply', undefined, 'ROBOT1.0_xxx')

      const [, init] = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        content: 'reply',
        msg_type: 0,
        msg_id: 'ROBOT1.0_xxx',
      })
    })

    it('throws QqBotError on a non-2xx send response', async () => {
      const client = newClient()
      mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }))
      mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, 429))
      await expect(client.sendMessage('user', 'o', 'hi')).rejects.toBeInstanceOf(QqBotError)
    })
  })

  describe('gatewayUrl', () => {
    it('returns the gateway url from /gateway/bot', async () => {
      const client = newClient()
      mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }))
      mockFetch.mockResolvedValueOnce(jsonResponse({ url: 'wss://gateway.example.com/ws' }))
      const url = await client.gatewayUrl()
      expect(url).toBe('wss://gateway.example.com/ws')
      const [requestUrl, init] = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(requestUrl).toBe(`${QQ_BOT_DEFAULT_BASE_URL}/gateway/bot`)
      expect((init.headers as Record<string, string>).authorization).toBe('QQBot tok-1')
    })
  })
})
