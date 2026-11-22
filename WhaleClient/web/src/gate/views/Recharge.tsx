/**
 * 充值弹窗：易支付在线充值 + 兑换码。
 * 收银台在新窗口打开；易支付付完会跳回 new-api 主站，这里轮询订单状态，到账后刷新余额。
 */
import { useEffect, useMemo, useState } from 'react'
import { hasScope, type StoredAuth } from '../api/auth.js'
import {
  createEpayOrder,
  epayMethods,
  fetchTopUpStatus,
  fetchTopupInfo,
  quotePayMoney,
  redeemCode,
  submitEpayForm,
  type TopupInfo,
} from '../api/wallet.js'
import { signOut } from '../session.js'

const PAY_WINDOW = 'whaleclient-pay'
const POLL_MS = 4000
const DEFAULT_PRESET_MULTIPLIERS = [1, 5, 10, 30, 50, 100]

export type QuoteUnit = {
  /** 1 美元对应的 quota */
  quotaPerUnit: number
  /** 美元 → 人民币汇率，余额页按人民币展示 */
  rate: number
  /** new-api 的额度展示方式；TOKENS 时充值数量单位是 token，其余是美元 */
  displayType?: string
}

const formatCny = (value: number) => `¥${value.toFixed(2)}`

const discountLabel = (discount: number) => `${Number((discount * 10).toFixed(1))}折`

type Props = { auth: StoredAuth; unit: QuoteUnit; onClose: () => void; onPaid: () => void }

export const Recharge = ({ auth, unit, onClose, onPaid }: Props) => {
  const canPay = !auth.keyOnly && hasScope(auth, 'wallet:write')

  const [info, setInfo] = useState<TopupInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'online' | 'redeem'>('online')
  /** 用户手动输入或点选的数量；null 表示还没选，用第一个预设 */
  const [pickedAmount, setPickedAmount] = useState<number | null>(null)
  const [method, setMethod] = useState('')
  const [payMoney, setPayMoney] = useState<number | null>(null)
  const [redeemKey, setRedeemKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 已下单、等待支付结果的订单号 */
  const [waitingTradeNo, setWaitingTradeNo] = useState('')

  useEffect(() => {
    if (!canPay) return
    let alive = true
    fetchTopupInfo(auth)
      .then((value) => {
        if (!alive) return
        setInfo(value ?? {})
        const methods = epayMethods(value ?? {})
        setMethod(methods[0]?.type ?? '')
        if (methods.length === 0 && value?.enable_redemption) setTab('redeem')
      })
      .catch((e: Error) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [auth, canPay])

  const methods = info ? epayMethods(info) : []
  const minTopup = Math.max(1, info?.min_topup ?? 1)
  const presets = useMemo(() => {
    const options = (info?.amount_options ?? []).filter((value) => value >= minTopup)
    return options.length > 0 ? options : DEFAULT_PRESET_MULTIPLIERS.map((multiplier) => multiplier * minTopup)
  }, [info, minTopup])
  const amount = pickedAmount ?? presets[0] ?? 0

  /** 充值数量换算成到账的人民币余额 */
  const creditCny = (value: number) =>
    unit.displayType === 'TOKENS' ? (value / unit.quotaPerUnit) * unit.rate : value * unit.rate

  const amountValid = Number.isInteger(amount) && amount >= minTopup

  // 实付金额以服务端计算为准（含分组倍率和折扣），输入停顿后再询价
  useEffect(() => {
    setPayMoney(null)
    setError('')
    if (!canPay || methods.length === 0 || !amountValid) return
    let alive = true
    const timer = setTimeout(() => {
      quotePayMoney(auth, amount)
        .then((money) => alive && setPayMoney(money))
        .catch((e: Error) => alive && setError(e.message))
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [auth, amount, amountValid, canPay, methods.length])

  const checkOrder = async (tradeNo: string): Promise<void> => {
    const status = await fetchTopUpStatus(auth, tradeNo)
    if (status === 'success') {
      setWaitingTradeNo('')
      setNotice('充值成功，余额已更新')
      onPaid()
    } else if (status === 'failed' || status === 'expired') {
      setWaitingTradeNo('')
      setError(status === 'expired' ? '订单已过期，请重新下单' : '支付失败，请重新下单')
    }
  }

  // 等待支付期间轮询订单；切回本页时立即查一次
  useEffect(() => {
    if (!waitingTradeNo) return
    const check = () => {
      checkOrder(waitingTradeNo).catch(() => undefined)
    }
    const timer = setInterval(check, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // checkOrder 只依赖 auth 和 onPaid，两者在弹窗生命周期内不变，随订单号重建即可
  }, [waitingTradeNo])

  const pay = async () => {
    setError('')
    setNotice('')
    if (!amountValid) {
      setError(`充值数量至少为 ${minTopup}，且必须是整数`)
      return
    }
    if (!method) {
      setError('请选择支付方式')
      return
    }
    // 必须在点击的同步阶段打开窗口，await 之后再开会被浏览器当成弹窗拦截
    const popup = window.open('', PAY_WINDOW)
    try {
      popup?.document.write('<p style="font:14px sans-serif;padding:24px;color:#555">正在前往支付…</p>')
    } catch {
      // 复用了上次停在收银台（跨域）的窗口，写不了提示，不影响跳转
    }
    setBusy(true)
    try {
      const order = await createEpayOrder(auth, amount, method)
      // 窗口被拦截时只能在当前页跳转，付完需手动回到小虎鲸
      submitEpayForm(order, popup ? PAY_WINDOW : '_self')
      setWaitingTradeNo(order.tradeNo)
    } catch (e) {
      popup?.close()
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const redeem = async () => {
    setError('')
    setNotice('')
    if (!redeemKey.trim()) {
      setError('请输入兑换码')
      return
    }
    setBusy(true)
    try {
      const quota = await redeemCode(auth, redeemKey.trim())
      setRedeemKey('')
      setNotice(`兑换成功，到账 ${formatCny((quota / unit.quotaPerUnit) * unit.rate)}`)
      onPaid()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const body = () => {
    if (auth.keyOnly) {
      return (
        <div className="usage-dialog-note">
          微信登录且未设置密码的账号暂不支持在这里充值。请在网页控制台设置密码后，用账号密码重新登录。
        </div>
      )
    }
    if (!canPay) {
      return (
        <>
          <div className="usage-dialog-note">充值需要重新登录一次，以授权本设备发起支付。</div>
          <button type="button" className="usage-dialog-pay" onClick={signOut}>
            重新登录
          </button>
        </>
      )
    }
    if (loadError) return <div className="usage-dialog-error">{loadError}</div>
    if (!info) return <div className="usage-dialog-note">正在读取支付方式…</div>
    if (methods.length === 0 && !info.enable_redemption) {
      return <div className="usage-dialog-note">管理员还没有开启在线充值。请把用户名发给管理员，由管理员给账号加额度。</div>
    }

    if (waitingTradeNo) {
      return (
        <>
          <div className="usage-dialog-note">
            请在新打开的页面完成支付。支付完成后可以直接关闭支付页面，回到这里会自动刷新余额。
          </div>
          <button
            type="button"
            className="usage-dialog-pay"
            onClick={() => checkOrder(waitingTradeNo).catch((e: Error) => setError(e.message))}
          >
            我已完成支付
          </button>
          <button type="button" className="usage-dialog-link" onClick={() => setWaitingTradeNo('')}>
            重新选择金额
          </button>
        </>
      )
    }

    return (
      <>
        {methods.length > 0 && info.enable_redemption ? (
          <div className="usage-tabs">
            <button type="button" className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}>
              在线充值
            </button>
            <button type="button" className={tab === 'redeem' ? 'on' : ''} onClick={() => setTab('redeem')}>
              兑换码
            </button>
          </div>
        ) : null}

        {tab === 'online' && methods.length > 0 ? (
          <>
            <div className="usage-presets">
              {presets.map((value) => {
                const discount = info.discount?.[String(value)] ?? 1
                return (
                  <button
                    key={value}
                    type="button"
                    className={amount === value ? 'usage-preset on' : 'usage-preset'}
                    onClick={() => setPickedAmount(value)}
                  >
                    <span>{formatCny(creditCny(value))}</span>
                    {discount > 0 && discount < 1 ? <em>{discountLabel(discount)}</em> : null}
                  </button>
                )
              })}
            </div>
            <label className="usage-field">
              自定义数量（最少 {minTopup}）
              <input
                inputMode="numeric"
                value={amount || ''}
                onChange={(event) => setPickedAmount(Number(event.target.value.replace(/\D/g, '')) || 0)}
              />
            </label>
            <div className="usage-quote">
              <span>到账 {amountValid ? formatCny(creditCny(amount)) : '—'}</span>
              <span>实付 {payMoney !== null ? formatCny(payMoney) : '…'}</span>
            </div>
            <div className="usage-methods">
              {methods.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className={method === item.type ? 'usage-method on' : 'usage-method'}
                  onClick={() => setMethod(item.type)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <button type="button" className="usage-dialog-pay" disabled={busy || !amountValid} onClick={pay}>
              {busy ? '正在下单…' : '去支付'}
            </button>
          </>
        ) : (
          <>
            <label className="usage-field">
              兑换码
              <input
                value={redeemKey}
                onChange={(event) => setRedeemKey(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && redeem()}
              />
            </label>
            <button type="button" className="usage-dialog-pay" disabled={busy} onClick={redeem}>
              {busy ? '兑换中…' : '兑换'}
            </button>
          </>
        )}
      </>
    )
  }

  return (
    <div className="usage-mask" onClick={onClose}>
      <div className="usage-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="usage-dialog-title">充值</div>
        {body()}
        {error ? <div className="usage-dialog-error">{error}</div> : null}
        {notice ? <div className="usage-dialog-notice">{notice}</div> : null}
        <button type="button" className="usage-dialog-link" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
