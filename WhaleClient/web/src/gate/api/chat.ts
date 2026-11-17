/** 聊天：用 PAT 换一个 API Key，再走 /v1 转发 */
import type { StoredAuth } from './auth.js'
import { request, requestRaw } from './http.js'

const KEY_NAME = 'WhaleClient Web'
const KEY_STORAGE = 'whaleclient:apikey'

type TokenRow = { id: number; name: string; status?: number; key?: string }
type TokenList = TokenRow[] | { items?: TokenRow[]; data?: TokenRow[] }

const rows = (list: TokenList): TokenRow[] =>
  Array.isArray(list) ? list : (list.items ?? list.data ?? [])

const cachedKey = (server: string): string | null => {
  try {
    const raw = localStorage.getItem(KEY_STORAGE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { server: string; key: string }
    return parsed.server === server ? parsed.key : null
  } catch {
    return null
  }
}

const rememberKey = (server: string, key: string): void => {
  localStorage.setItem(KEY_STORAGE, JSON.stringify({ server, key }))
}

/** 换账号登录前清掉上个账号缓存的 Key，否则会拿别人的 Key 聊天 */
export const forgetApiKey = (): void => {
  localStorage.removeItem(KEY_STORAGE)
}

/** 找到或创建一个 API Key；PAT 需要 api_key:read / reveal / write 三个权限 */
export const ensureApiKey = async (auth: StoredAuth): Promise<string> => {
  const cached = cachedKey(auth.server)
  if (cached) return cached

  const list = await request<TokenList>(auth.server, '/api/token/?p=1&page_size=100', {
    method: 'GET',
    bearer: auth.token,
  })
  const existing = rows(list).find((row) => row.name === KEY_NAME && row.status === 1)
  if (existing) {
    const revealed = await request<{ key: string }>(auth.server, `/api/token/${existing.id}/key`, {
      method: 'POST',
      bearer: auth.token,
    })
    rememberKey(auth.server, revealed.key)
    return revealed.key
  }

  await request(auth.server, '/api/token/', {
    method: 'POST',
    bearer: auth.token,
    json: {
      name: KEY_NAME,
      remain_quota: 0,
      unlimited_quota: true,
      expired_time: -1,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: '',
    },
  })

  const after = await request<TokenList>(auth.server, '/api/token/?p=1&page_size=100', {
    method: 'GET',
    bearer: auth.token,
  })
  const created = rows(after).find((row) => row.name === KEY_NAME && row.status === 1)
  if (!created) throw new Error('创建 API Key 后没有找到它')
  const revealed = await request<{ key: string }>(auth.server, `/api/token/${created.id}/key`, {
    method: 'POST',
    bearer: auth.token,
  })
  rememberKey(auth.server, revealed.key)
  return revealed.key
}

export const listModels = async (server: string, key: string): Promise<string[]> => {
  const data = await request<{ data?: { id: string }[] }>(server, '/v1/models', {
    method: 'GET',
    bearer: key,
  })
  return (data.data ?? []).map((item) => item.id)
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export type StreamHandlers = {
  onDelta: (text: string) => void
  onDone?: () => void
  signal?: AbortSignal
}

/** 流式聊天：解析 OpenAI 兼容的 SSE */
export const streamChat = async (
  server: string,
  key: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers
): Promise<void> => {
  const response = await requestRaw(server, '/v1/chat/completions', {
    method: 'POST',
    bearer: key,
    signal: handlers.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  })

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text.slice(0, 300) || `HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          handlers.onDone?.()
          return
        }
        try {
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
          const text = chunk.choices?.[0]?.delta?.content
          if (text) handlers.onDelta(text)
        } catch {
          // 忽略心跳或残缺行
        }
      }
      index = buffer.indexOf('\n')
    }
  }
  handlers.onDone?.()
}
