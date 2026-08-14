import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as tool from '../src/index.ts'

const mockFetch = vi.fn()
const testToolSignal = new AbortController().signal
let callCounter = 0

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

/** 非 inbound 测试不需要真实 agent 工厂，只需服务存在（否则 cordis 因 inject 缺失跳过 apply）。 */
function provideMockAgents(ctx: Context): void {
  ctx.provide('agents', {} as never)
}

async function setup(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  provideMockAgents(ctx)
  await ctx.plugin(tool, { appId: 'app-1', appSecret: 'secret-1', ...config })
  return ctx
}

function execute(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name: 'qq_send_message',
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-qq-bot', () => {
  it('registers qq_send_message with channel/openid/content/format schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'qq_send_message')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['channel', 'content', 'format', 'openid'])
    expect((props.channel as { enum?: string[] }).enum).toEqual(['user', 'group'])
    expect((props.format as { enum?: string[] }).enum).toEqual(['text', 'markdown'])
  })

  it('sends a text message when format is omitted', async () => {
    const ctx = await setup()
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 7200 }))
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'm1', timestamp: 't' }))

    const result = await execute(ctx, { channel: 'user', openid: 'o1', content: 'hello' })
    expect(result.isError).toBe(false)

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello', msg_type: 0 })
  })

  it('sends a markdown message when format=markdown', async () => {
    const ctx = await setup()
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 7200 }))
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'm2', timestamp: 't' }))

    const result = await execute(ctx, { channel: 'user', openid: 'o1', content: '# hi', format: 'markdown' })
    expect(result.isError).toBe(false)

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      markdown: { content: '# hi' },
      msg_type: 2,
    })
  })

  it('rejects empty content as an isError result', async () => {
    const ctx = await setup()
    const result = await execute(ctx, { channel: 'user', openid: 'o1', content: '   ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('non-empty')
  })

  it('rejects an unknown format value at registry validation', async () => {
    const ctx = await setup()
    const result = await execute(ctx, { channel: 'user', openid: 'o1', content: 'hi', format: 'html' })
    expect(result.isError).toBe(true)
  })

  it('presents the call with a stable title and raw input', async () => {
    const ctx = await setup()
    const def = ctx.tools.get('qq_send_message')!
    expect(def.presentCall?.({ channel: 'user', openid: 'o1', content: 'hi', format: 'text' })).toEqual({
      card: 'generic',
      title: 'Send QQ message',
      kind: 'other',
      rawInput: { channel: 'user', openid: 'o1', content: 'hi', format: 'text' },
    })
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('qq-bot')
    expect(tool.inject).toEqual(['tools', 'agents'])
    expect(typeof tool.apply).toBe('function')
  })

  it('throws when inbound is enabled without inboundProvider/inboundModel', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    provideMockAgents(ctx)
    let message = ''
    try {
      await ctx.plugin(tool, { appId: 'a', appSecret: 's', inbound: true })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('inboundProvider and inboundModel')
  })
})
