import { useEffect, useState } from 'react'
import {
  fetchStatus,
  login,
  registerAccount,
  submitLoginCode,
  type ServerStatus,
  type StoredAuth,
} from '../api/auth.js'

const LAST_SERVER = 'whaleclient:server'
/** 默认服务器；用户改过就以本地保存的为准 */
const DEFAULT_SERVER = ''

type Mode = 'login' | 'register'

export const Login = ({ onDone }: { onDone: (auth: StoredAuth) => void }) => {
  const [server, setServer] = useState(() => localStorage.getItem(LAST_SERVER) ?? DEFAULT_SERVER)
  const [mode, setMode] = useState<Mode>('login')
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [flowToken, setFlowToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchStatus(server)
      .then((value) => alive && setStatus(value))
      .catch(() => alive && setStatus(null))
    return () => {
      alive = false
    }
  }, [server])

  const canRegister = status?.register_enabled !== false && status?.password_register_enabled !== false

  const submit = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      localStorage.setItem(LAST_SERVER, server.trim())

      if (flowToken) {
        onDone(await submitLoginCode(server, flowToken, code.trim(), password))
        return
      }

      if (mode === 'register') {
        if (password !== confirm) throw new Error('两次密码不一致')
        if (status?.turnstile_check) throw new Error('该站开启了人机验证，请在网页后台注册')
        await registerAccount(server, {
          username: username.trim(),
          password,
          email: status?.email_verification ? email.trim() : undefined,
          code: status?.email_verification ? code.trim() : undefined,
        })
        setNotice('注册成功，正在登录…')
        onDone(await expectAuth(login(server, username.trim(), password)))
        return
      }

      const result = await login(server, username.trim(), password)
      if ('need2fa' in result) {
        setFlowToken(result.flowToken)
        setBusy(false)
        return
      }
      onDone(result)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const title = flowToken ? '两步验证' : mode === 'register' ? '注册' : '登录'

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <img className="brand-logo" src="brand-avatar.png" alt="" />
          <div className="brand-name">鲸鱼娘</div>
        </div>

        {flowToken ? null : (
          <div className="tabs">
            <button
              className={mode === 'login' ? 'tab active' : 'tab'}
              onClick={() => {
                setMode('login')
                setError('')
              }}
            >
              登录
            </button>
            <button
              className={mode === 'register' ? 'tab active' : 'tab'}
              disabled={!canRegister}
              onClick={() => {
                setMode('register')
                setError('')
              }}
            >
              注册
            </button>
          </div>
        )}

        {mode === 'register' && !canRegister ? (
          <div className="error">该服务器未开放注册</div>
        ) : null}

        <label className="field">
          <span>服务器</span>
          <input value={server} placeholder="留空 = 同源代理" onChange={(e) => setServer(e.target.value)} />
        </label>

        {flowToken ? (
          <label className="field">
            <span>两步验证码</span>
            <input
              value={code}
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span>用户名</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && submit()}
              />
            </label>
            {mode === 'register' ? (
              <>
                <label className="field">
                  <span>确认密码</span>
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </label>
                {status?.email_verification ? (
                  <>
                    <label className="field">
                      <span>邮箱</span>
                      <input value={email} onChange={(e) => setEmail(e.target.value)} />
                    </label>
                    <label className="field">
                      <span>邮箱验证码</span>
                      <input value={code} onChange={(e) => setCode(e.target.value)} />
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {error ? <div className="error">{error}</div> : null}
        {notice ? <div className="notice">{notice}</div> : null}

        <button className="primary" disabled={busy || (mode === 'register' && !canRegister)} onClick={submit}>
          {busy ? '处理中…' : flowToken ? '验证' : title}
        </button>
      </div>
    </div>
  )
}

/** login() 可能返回需要 2FA 的结果；注册后自动登录遇到 2FA 直接拒绝并提示 */
const expectAuth = async (
  pending: ReturnType<typeof login>
): Promise<StoredAuth> => {
  const result = await pending
  if ('need2fa' in result) throw new Error('该账号开启了两步验证，请回到登录页验证')
  return result
}
