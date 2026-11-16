import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { currentAccount, isValidPhone, login, register } from '../../services/account.js'
import { Button } from '../base/Button.js'
import styles from './LoginGate.module.css'

/**
 * 首次启动的登录 / 注册页。
 * 账号只存在本机，不走短信验证码，也不需要服务器。
 */
export const LoginGate = ({ children }: { children: React.ReactNode }) => {
  const t = useTranslate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (currentAccount()) {
    return <>{children}</>
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') {
        await register(phone, password, nickname)
      } else {
        await login(phone, password)
      }
      location.reload()
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      setError(
        code === 'phone'
          ? t('accountErrPhone')
          : code === 'password'
            ? t('accountErrPassword')
            : code === 'exists'
              ? t('accountErrExists')
              : code === 'noUser'
                ? t('accountErrNoUser')
                : code === 'badPassword'
                  ? t('accountErrBadPassword')
                  : String(e)
      )
      setBusy(false)
    }
  }

  const valid = isValidPhone(phone) && password.length >= 6

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.title}>{mode === 'login' ? t('accountLoginTitle') : t('accountRegisterTitle')}</div>
        <div className={styles.subtitle}>{t('accountLocalHint')}</div>

        <label className={styles.field}>
          <span className={styles.label}>{t('accountPhone')}</span>
          <input
            className={styles.input}
            inputMode="numeric"
            autoComplete="tel"
            maxLength={11}
            value={phone}
            placeholder="13800000000"
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        {mode === 'register' ? (
          <label className={styles.field}>
            <span className={styles.label}>{t('accountNickname')}</span>
            <input
              className={styles.input}
              value={nickname}
              maxLength={16}
              placeholder={t('accountNicknamePlaceholder')}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
        ) : null}

        <label className={styles.field}>
          <span className={styles.label}>{t('accountPassword')}</span>
          <input
            className={styles.input}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            maxLength={32}
            placeholder={t('accountPasswordPlaceholder')}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !busy) {
                void submit()
              }
            }}
          />
        </label>

        {error ? <div className={styles.error}>{error}</div> : null}

        <Button block disabled={!valid || busy} onClick={() => void submit()}>
          {mode === 'login' ? t('accountLoginBtn') : t('accountRegisterBtn')}
        </Button>

        <button
          type="button"
          className={styles.switch}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
          }}
        >
          {mode === 'login' ? t('accountToRegister') : t('accountToLogin')}
        </button>
      </div>
    </div>
  )
}
