import { useEffect, useState, type ReactNode } from 'react'
import {
  fetchStatus,
  login,
  registerAccount,
  submitLoginCode,
  submitStepUpCode,
  wechatLogin,
  type LoginStep,
  type ServerStatus,
  type StepUpMethod,
  type StoredAuth,
} from '../api/auth.js'
import { ApiError } from '../api/http.js'
import { Turnstile } from './Turnstile.js'

const LAST_SERVER = 'whaleclient:server'
/** 默认服务器；用户改过就以本地保存的为准 */
const DEFAULT_SERVER = ''

type Mode = 'login' | 'register' | 'wechat'

/** 登录流程里还要再输一次验证码的那一步 */
type CodeStep = Exclude<LoginStep, { kind: 'done' }>

type Field = 'username' | 'password' | 'confirm' | 'email' | 'code'
type FieldError = { field: Field; message: string }
type Notice = { tone: 'info' | 'success'; text: string }

/** 创建长期令牌前的再次验证：2FA 要等验证器刷新，微信要在公众号重新获取 */
const STEP_UP_NOTICE: Record<StepUpMethod, string> = {
  '2fa': '为了授权此设备，请等验证器刷新后输入新的验证码',
  wechat: '为了授权此设备，请在公众号再回复一次「验证码」，输入新收到的验证码',
}

const STEP_UP_LABEL: Record<StepUpMethod, string> = {
  '2fa': '授权此设备：两步验证码',
  wechat: '授权此设备：微信验证码',
}

/** 能对应到某个输入框的后端错误（按 message_key），显示在该输入框下方 */
const FIELD_BY_KEY: Record<string, Field> = {
  'Username or password is incorrect, or user has been banned': 'password',
  'Username already exists or has been deleted': 'username',
  'Email address is already in use': 'email',
  'Verification code is incorrect or has expired': 'code',
  'Verification failed. Please try again.': 'code',
}

/** 本地校验失败，直接标在对应输入框下 */
class InputError extends Error {
  constructor(
    readonly field: Field,
    message: string
  ) {
    super(message)
  }
}

export const Login = ({ onDone }: { onDone: (auth: StoredAuth) => void }) => {
  const [server, setServer] = useState(() => localStorage.getItem(LAST_SERVER) ?? DEFAULT_SERVER)
  const [mode, setMode] = useState<Mode>('login')
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<CodeStep | null>(null)
  /** 进入两步验证时是否是微信登录（微信登录没有密码可用于后续安全验证） */
  const [viaWechat, setViaWechat] = useState(false)
  /** 与具体输入框无关的错误（网络、限流、权限等），显示在按钮上方 */
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<FieldError | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  /** 换 key 让验证框重新挂载，拿一个新 token */
  const [turnstileKey, setTurnstileKey] = useState(0)

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
  const canWechat = Boolean(status?.wechat_login)
  // 与主站一致：开关和 site key 都有才算开启。微信登录、两步验证接口不校验 Turnstile
  const turnstileSiteKey = status?.turnstile_check ? (status.turnstile_site_key ?? '') : ''
  const showTurnstile = Boolean(turnstileSiteKey) && !step && mode !== 'wechat'

  const resetTurnstile = () => {
    setTurnstileToken('')
    setTurnstileKey((key) => key + 1)
  }

  /** 登录结果要么结束，要么进入下一个验证码步骤 */
  const advance = (next: LoginStep) => {
    if (next.kind === 'done') {
      onDone(next.auth)
      return
    }
    setStep(next)
    setCode('')
    setNotice(next.kind === 'stepUpCode' ? { tone: 'info', text: STEP_UP_NOTICE[next.method] } : null)
    setBusy(false)
  }

  const clearMessages = () => {
    setError('')
    setFieldError(null)
    setNotice(null)
  }

  /** 用户改了哪个输入框，就清掉那个输入框下的错误 */
  const clearFieldError = (field: Field) => setFieldError((current) => (current?.field === field ? null : current))

  const switchMode = (next: Mode) => {
    setMode(next)
    clearMessages()
    setCode('')
  }

  const submit = async () => {
    setBusy(true)
    clearMessages()
    try {
      localStorage.setItem(LAST_SERVER, server.trim())

      if (step?.kind === 'loginCode') {
        advance(await submitLoginCode(server, step.flowToken, code.trim(), viaWechat ? null : password))
        return
      }
      if (step?.kind === 'stepUpCode') {
        onDone(await submitStepUpCode(step.pending, step.method, code.trim()))
        return
      }

      if (mode === 'wechat') {
        if (!code.trim()) throw new InputError('code', '请输入微信验证码')
        setViaWechat(true)
        advance(await wechatLogin(server, code.trim()))
        return
      }

      if (mode === 'register' && password !== confirm) throw new InputError('confirm', '两次密码不一致')

      const turnstile = turnstileSiteKey ? turnstileToken : undefined
      if (turnstileSiteKey && !turnstile) throw new Error('请先完成人机验证')
      // token 只能用一次，无论请求成败都换新的
      if (turnstile) resetTurnstile()

      if (mode === 'register') {
        await registerAccount(server, {
          username: username.trim(),
          password,
          email: status?.email_verification ? email.trim() : undefined,
          code: status?.email_verification ? code.trim() : undefined,
          turnstile,
        })
        if (turnstile) {
          // 登录接口也要校验，刚才的 token 已用掉，回登录页让用户再验证一次
          switchMode('login')
          setConfirm('')
          setNotice({ tone: 'success', text: '注册成功，请完成人机验证后登录' })
          setBusy(false)
          return
        }
        setNotice({ tone: 'success', text: '注册成功，正在登录…' })
        onDone(await expectAuth(login(server, username.trim(), password)))
        return
      }

      setViaWechat(false)
      advance(await login(server, username.trim(), password, turnstile))
    } catch (e) {
      const field =
        e instanceof InputError ? e.field : e instanceof ApiError && e.key ? FIELD_BY_KEY[e.key] : undefined
      let message = (e as Error).message
      const weChatCode = (mode === 'wechat' && !step) || (step?.kind === 'stepUpCode' && step.method === 'wechat')
      if (field === 'code' && weChatCode && e instanceof ApiError) {
        message = '验证码错误或已过期，请在公众号重新回复「验证码」获取新的验证码'
      }
      if (field) setFieldError({ field, message })
      else setError(message)
      setBusy(false)
    }
  }

  const stepTitle = step?.kind === 'stepUpCode' && step.method === 'wechat' ? '授权此设备' : '两步验证'
  const title = step ? stepTitle : mode === 'register' ? '注册' : mode === 'wechat' ? '微信登录' : '登录'

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <img className="brand-logo" src="brand-avatar.png" alt="" />
          <div className="brand-name">小虎鲸</div>
        </div>

        {step ? null : (
          <div className="tabs">
            <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => switchMode('login')}>
              登录
            </button>
            {canWechat ? (
              <button className={mode === 'wechat' ? 'tab active' : 'tab'} onClick={() => switchMode('wechat')}>
                微信登录
              </button>
            ) : null}
            <button
              className={mode === 'register' ? 'tab active' : 'tab'}
              disabled={!canRegister}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>
        )}

        {mode === 'register' && !canRegister ? (
          <Alert tone="error">该服务器未开放注册</Alert>
        ) : null}

        {step ? (
          <label className="field">
            <span>{step.kind === 'stepUpCode' ? STEP_UP_LABEL[step.method] : '两步验证码'}</span>
            <input
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-invalid={fieldError?.field === 'code'}
              onChange={(e) => {
                setCode(e.target.value)
                clearFieldError('code')
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <FieldHint error={fieldError} field="code" />
          </label>
        ) : mode === 'wechat' ? (
          <>
            {status?.wechat_qrcode ? (
              <img className="wechat-qr" src={status.wechat_qrcode} alt="微信公众号二维码" />
            ) : null}
            <p className="wechat-hint">扫描二维码关注公众号，回复“验证码”以接收验证码。</p>
            <label className="field">
              <span>微信验证码</span>
              <input
                value={code}
                aria-invalid={fieldError?.field === 'code'}
                onChange={(e) => {
                  setCode(e.target.value)
                  clearFieldError('code')
                }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <FieldHint error={fieldError} field="code" />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>用户名</span>
              <input
                value={username}
                aria-invalid={fieldError?.field === 'username'}
                onChange={(e) => {
                  setUsername(e.target.value)
                  clearFieldError('username')
                  // 用户名和密码错误是同一条提示，改哪个都算处理过
                  clearFieldError('password')
                }}
              />
              <FieldHint error={fieldError} field="username" />
            </label>
            <label className="field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                aria-invalid={fieldError?.field === 'password'}
                onChange={(e) => {
                  setPassword(e.target.value)
                  clearFieldError('password')
                }}
                onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && submit()}
              />
              <FieldHint error={fieldError} field="password" />
            </label>
            {mode === 'register' ? (
              <>
                <label className="field">
                  <span>确认密码</span>
                  <input
                    type="password"
                    value={confirm}
                    aria-invalid={fieldError?.field === 'confirm'}
                    onChange={(e) => {
                      setConfirm(e.target.value)
                      clearFieldError('confirm')
                    }}
                  />
                  <FieldHint error={fieldError} field="confirm" />
                </label>
                {status?.email_verification ? (
                  <>
                    <label className="field">
                      <span>邮箱</span>
                      <input
                        value={email}
                        aria-invalid={fieldError?.field === 'email'}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          clearFieldError('email')
                        }}
                      />
                      <FieldHint error={fieldError} field="email" />
                    </label>
                    <label className="field">
                      <span>邮箱验证码</span>
                      <input
                        value={code}
                        aria-invalid={fieldError?.field === 'code'}
                        onChange={(e) => {
                          setCode(e.target.value)
                          clearFieldError('code')
                        }}
                      />
                      <FieldHint error={fieldError} field="code" />
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {showTurnstile ? (
          <Turnstile
            key={turnstileKey}
            siteKey={turnstileSiteKey}
            onVerify={setTurnstileToken}
            onExpire={() => setTurnstileToken('')}
            onError={setError}
          />
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

        <button className="primary" disabled={busy || (mode === 'register' && !canRegister)} onClick={submit}>
          {busy ? '处理中…' : step ? '验证' : title}
        </button>
        {step ? (
          <button
            className="link-button"
            disabled={busy}
            onClick={() => {
              setStep(null)
              setCode('')
              clearMessages()
            }}
          >
            返回
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 注册后自动登录；新账号不会有两步验证，遇到了就让用户回登录页 */
const expectAuth = async (pending: Promise<LoginStep>): Promise<StoredAuth> => {
  const result = await pending
  if (result.kind !== 'done') throw new Error('该账号开启了两步验证，请回到登录页验证')
  return result.auth
}

const AlertIcon = ({ tone }: { tone: 'error' | 'info' | 'success' }) => (
  <svg className="alert-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
    {tone === 'success' ? (
      <path d="m5.2 8.2 1.9 1.9 3.7-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    ) : tone === 'info' ? (
      <path d="M8 7.2v3.6M8 5.2v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    ) : (
      <path d="M8 4.8v3.6M8 10.8v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    )}
  </svg>
)

/** 通用提示框：错误、提示、成功三种色调 */
const Alert = ({ tone, children }: { tone: 'error' | 'info' | 'success'; children: ReactNode }) => (
  <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    <AlertIcon tone={tone} />
    <span>{children}</span>
  </div>
)

/** 输入框下方的错误；只有错误属于这个输入框时才显示 */
const FieldHint = ({ error, field }: { error: FieldError | null; field: Field }) =>
  error?.field === field ? (
    <div className="field-error" role="alert">
      <AlertIcon tone="error" />
      <span>{error.message}</span>
    </div>
  ) : null
