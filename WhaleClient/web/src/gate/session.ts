/** 登录会话（new-api 账号 + PAT），供侧栏账号块读取 */
import { clearAuth, loadAuth, type StoredAuth } from './api/auth.js'
import { forgetApiKey } from './api/chat.js'

const USER_STORAGE = 'whaleclient:user'
const API_KEY_STORAGE = 'chat-demo:api-key'

export type Session = { username: string; server: string; quota?: number }

export const readSession = (): Session | null => {
  const auth = loadAuth()
  if (!auth) return null
  let username = ''
  try {
    username = (JSON.parse(localStorage.getItem(USER_STORAGE) ?? '{}') as { username?: string }).username ?? ''
  } catch {
    username = ''
  }
  return { username, server: auth.server, quota: undefined }
}

export const rememberUser = (username: string): void => {
  localStorage.setItem(USER_STORAGE, JSON.stringify({ username }))
}

/** 服务器地址去掉协议，便于在窄侧栏显示 */
export const shortServer = (server: string): string => server.replace(/^https?:\/\//, '')

export const signOut = (): void => {
  clearAuth()
  forgetApiKey()
  localStorage.removeItem(USER_STORAGE)
  localStorage.removeItem(API_KEY_STORAGE)
  location.reload()
}
