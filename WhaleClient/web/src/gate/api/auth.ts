/**
 * 登录与个人访问令牌（PAT）。
 * 流程与仓库里的 iOS 客户端一致：密码登录 → 安全验证 → 建 PAT → 注销临时会话。
 */
import { ApiError, normalizeServer, request } from './http.js'

export const PAT_SCOPES = ['api_key:read', 'api_key:reveal', 'api_key:write', 'profile:read']
const PAT_LIFETIME_SECONDS = 90 * 24 * 3600

export type StoredAuth = {
  server: string
  token: string
  expiresAt: number
  user?: { id?: number; username?: string; display_name?: string; quota?: number }
}

const STORAGE_KEY = 'whaleclient:auth'

export const loadAuth = (): StoredAuth | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredAuth) : null
  } catch {
    return null
  }
}

export const saveAuth = (auth: StoredAuth): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
}

export const clearAuth = (): void => {
  localStorage.removeItem(STORAGE_KEY)
}

type EncryptionKey = { enabled: boolean; kid?: string; public_key?: string }

/** 服务端开启密码加密时用 RSA-OAEP 加密；否则明文，靠 HTTPS 保护 */
const encryptPassword = async (server: string, password: string): Promise<Record<string, string>> => {
  const key = await request<EncryptionKey>(server, '/api/user/login/encryption-key', { method: 'GET' })
  if (!key?.enabled || !key.kid || !key.public_key) {
    return { password }
  }
  const pem = key.public_key
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  )
  const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, cryptoKey, new TextEncoder().encode(password))
  return { password_encrypted: btoa(String.fromCharCode(...new Uint8Array(cipher))), encryption_key_id: key.kid }
}

type LoginResponse = {
  access_token?: string
  require_verification?: boolean
  flow_token?: string
  methods?: { method: string; available: boolean }[]
}

export const login = async (
  rawServer: string,
  username: string,
  password: string
): Promise<{ need2fa: true; flowToken: string } | StoredAuth> => {
  const server = normalizeServer(rawServer)
  const passwordBody = await encryptPassword(server, password)
  const result = await request<LoginResponse>(server, '/api/user/login', {
    method: 'POST',
    json: { username, ...passwordBody },
  })

  if (result.require_verification) {
    if (!result.flow_token) throw new ApiError('登录响应缺少 flow_token')
    return { need2fa: true, flowToken: result.flow_token }
  }
  if (!result.access_token) throw new ApiError('登录响应缺少 access_token')
  return finishLogin(server, result.access_token, password)
}

export const submitLoginCode = async (
  server: string,
  flowToken: string,
  code: string,
  password: string
): Promise<StoredAuth> => {
  const result = await request<LoginResponse>(server, '/api/user/login/verify', {
    method: 'POST',
    json: { flow_token: flowToken, method: '2fa', code },
  })
  if (!result.access_token) throw new ApiError('二次验证失败')
  return finishLogin(normalizeServer(server), result.access_token, password)
}

/** 用临时会话令牌换一个长期 PAT，然后注销临时会话 */
const finishLogin = async (server: string, sessionToken: string, password: string): Promise<StoredAuth> => {
  const scopes = [...PAT_SCOPES].sort()
  const expiresAt = Math.floor(Date.now() / 1000) + PAT_LIFETIME_SECONDS
  const context = { scopes, expires_at: expiresAt }

  const requirements = await request<{ methods: { method: string; available: boolean }[] }>(
    server,
    '/api/verify/methods?scope=access_token.generate',
    { method: 'GET', bearer: sessionToken }
  )
  const available = new Set((requirements.methods ?? []).filter((m) => m.available).map((m) => m.method))

  let proofBody: Record<string, unknown>
  if (available.has('password')) {
    proofBody = { method: 'password', scope: 'access_token.generate', context, ...(await encryptPassword(server, password)) }
  } else {
    throw new ApiError('该账号只能用 Passkey 或第三方登录完成安全验证，暂不支持')
  }

  const proof = await request<{ proof_token: string }>(server, '/api/verify', {
    method: 'POST',
    bearer: sessionToken,
    json: proofBody,
  })

  const created = await request<{ token: string }>(server, '/api/user/access_tokens', {
    method: 'POST',
    bearer: sessionToken,
    headers: { 'X-Security-Proof': proof.proof_token },
    json: { name: `鲸鱼娘 Web · ${navigator.platform || 'browser'}`, scopes, expires_at: expiresAt },
  })

  await request(server, '/api/user/auth/logout', {
    method: 'POST',
    bearer: sessionToken,
    headers: { Origin: server },
  }).catch(() => undefined)

  const auth: StoredAuth = { server, token: created.token, expiresAt }
  saveAuth(auth)
  return auth
}

export const fetchSelf = async (auth: StoredAuth): Promise<StoredAuth['user']> => {
  const data = await request<StoredAuth['user']>(auth.server, '/api/user/self', {
    method: 'GET',
    bearer: auth.token,
  })
  return data
}

export type ServerStatus = {
  register_enabled?: boolean
  password_register_enabled?: boolean
  email_verification?: boolean
  turnstile_check?: boolean
}

export const fetchStatus = async (rawServer: string): Promise<ServerStatus> => {
  const server = normalizeServer(rawServer)
  return request<ServerStatus>(server, '/api/status', { method: 'GET' })
}

export type RegisterInput = { username: string; password: string; email?: string; code?: string; affCode?: string }

/** 注册后不会自动登录，服务端只返回成功 */
export const registerAccount = async (rawServer: string, input: RegisterInput): Promise<void> => {
  const server = normalizeServer(rawServer)
  await request(server, '/api/user/register', {
    method: 'POST',
    json: {
      username: input.username,
      password: input.password,
      ...(input.email ? { email: input.email } : {}),
      ...(input.code ? { verification_code: input.code } : {}),
      ...(input.affCode ? { aff_code: input.affCode } : {}),
    },
  })
}
