/**
 * 本地手机号账号。
 *
 * 没有后端：账号表存在本机 localStorage，密码用 SHA-256 加盐散列后保存。
 * 会话数据按账号隔离：IndexedDB 库名带手机号，切换账号等于换一个库。
 */

export type StoredAccount = {
  phone: string
  nickname: string
  salt: string
  hash: string
  createdAt: number
}

const ACCOUNTS_KEY = 'ds:accounts'
const SESSION_KEY = 'ds:session'
/** 第一台设备上的第一个账号沿用旧库名 chat-demo，升级后旧记录仍可见 */
const PRIMARY_KEY = 'ds:primary'
const PHONE_RE = /^1[3-9]\d{9}$/

export const isValidPhone = (phone: string): boolean => PHONE_RE.test(phone.trim())

const readAll = (): StoredAccount[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]')
    return Array.isArray(raw) ? (raw as StoredAccount[]) : []
  } catch {
    return []
  }
}

const writeAll = (list: StoredAccount[]): void => {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list))
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const digest = async (text: string): Promise<string> => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  }
  // 极老内核的退路：仅用于本机离线校验，强度不如 SHA-256
  let h1 = 0
  let h2 = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    h1 = (h1 * 31 + c) >>> 0
    h2 = (h2 * 131 + c) >>> 0
  }
  return `w${h1.toString(16)}${h2.toString(16)}`
}

export const currentPhone = (): string => {
  try {
    return localStorage.getItem(SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

export const currentAccount = (): StoredAccount | null => {
  const phone = currentPhone()
  return phone ? (readAll().find((item) => item.phone === phone) ?? null) : null
}

export type AccountError = 'phone' | 'password' | 'exists' | 'noUser' | 'badPassword'

export const register = async (phone: string, password: string, nickname?: string): Promise<void> => {
  const value = phone.trim()
  if (!isValidPhone(value)) {
    throw new Error('phone' satisfies AccountError)
  }
  if (password.length < 6) {
    throw new Error('password' satisfies AccountError)
  }
  const all = readAll()
  if (all.some((item) => item.phone === value)) {
    throw new Error('exists' satisfies AccountError)
  }
  const salt = Math.random().toString(36).slice(2, 10)
  const hash = await digest(`${salt}:${password}`)
  all.push({
    phone: value,
    nickname: nickname?.trim() || `用户${value.slice(-4)}`,
    salt,
    hash,
    createdAt: Date.now(),
  })
  writeAll(all)
  if (!localStorage.getItem(PRIMARY_KEY)) {
    localStorage.setItem(PRIMARY_KEY, value)
  }
  localStorage.setItem(SESSION_KEY, value)
}

export const login = async (phone: string, password: string): Promise<void> => {
  const value = phone.trim()
  if (!isValidPhone(value)) {
    throw new Error('phone' satisfies AccountError)
  }
  const account = readAll().find((item) => item.phone === value)
  if (!account) {
    throw new Error('noUser' satisfies AccountError)
  }
  const hash = await digest(`${account.salt}:${password}`)
  if (hash !== account.hash) {
    throw new Error('badPassword' satisfies AccountError)
  }
  localStorage.setItem(SESSION_KEY, value)
}

export const logout = (): void => {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // 忽略
  }
  location.reload()
}

/** 当前账号的存储键；未登录时用 guest，保证首次登录前也能正常打开 */
export const accountKey = (): string => currentPhone() || 'guest'

/** IndexedDB 库名：首个账号沿用旧库名，其他账号各自一个库 */
export const dbName = (): string => {
  const phone = currentPhone()
  if (!phone) return 'chat-demo'
  return localStorage.getItem(PRIMARY_KEY) === phone ? 'chat-demo' : `chat-demo:${phone}`
}

export const maskedPhone = (phone: string): string =>
  phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone
