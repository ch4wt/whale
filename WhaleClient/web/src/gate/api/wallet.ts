/**
 * 充值：易支付下单与兑换码，直接调用 new-api 的 /api/user/* 接口。
 * 支付完成后易支付会跳回 new-api 主站，客户端靠轮询订单状态得知到账。
 */
import type { StoredAuth } from './auth.js'
import { ApiError, request, requestRaw, responseError, type ApiEnvelope } from './http.js'

export type PayMethod = { name: string; type: string; min_topup?: string }

export type TopupInfo = {
  enable_online_topup?: boolean
  enable_redemption?: boolean
  pay_methods?: PayMethod[]
  min_topup?: number
  amount_options?: number[]
  /** 金额 → 折扣，如 { "100": 0.9 } */
  discount?: Record<string, number>
}

export type EpayOrder = { url: string; params: Record<string, string>; tradeNo: string }

export type TopUpStatus = 'pending' | 'success' | 'failed' | 'expired'

/** 这些支付方式走各自的专用接口，不是易支付 */
const NON_EPAY_TYPES = new Set(['stripe', 'creem', 'waffo', 'waffo_pancake'])

export const SCOPE_DENIED_MESSAGE = '当前登录凭证没有充值权限，请退出后重新登录'

export const fetchTopupInfo = (auth: StoredAuth): Promise<TopupInfo> =>
  request<TopupInfo>(auth.server, '/api/user/topup/info', { method: 'GET', bearer: auth.token })

/** 后台配置的支付方式里属于易支付的那些（支付宝、微信等） */
export const epayMethods = (info: TopupInfo): PayMethod[] =>
  info.enable_online_topup ? (info.pay_methods ?? []).filter((method) => !NON_EPAY_TYPES.has(method.type)) : []

type PaymentBody = ApiEnvelope<unknown> & { url?: string }

/**
 * 支付接口的响应是 {message: "success" | "error", data, url}，没有 success 字段，
 * 不能用通用的 request()；鉴权、限流等中间件错误仍是 {success: false, message}。
 */
const paymentRequest = async (auth: StoredAuth, path: string, json: unknown): Promise<PaymentBody> => {
  let response: Response
  try {
    response = await requestRaw(auth.server, path, {
      method: 'POST',
      bearer: auth.token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    })
  } catch (error) {
    throw new ApiError(`连不上服务器：${(error as Error).message}`)
  }
  if (response.status === 403) throw new ApiError(SCOPE_DENIED_MESSAGE, 403)

  let body: PaymentBody | null = null
  try {
    body = (await response.json()) as PaymentBody
  } catch {
    throw responseError(response, null)
  }
  if (!response.ok || body?.success === false || body?.message !== 'success') {
    throw responseError(response, body)
  }
  return body
}

/** 服务端按用户分组倍率、折扣算出的实付金额（元） */
export const quotePayMoney = async (auth: StoredAuth, amount: number): Promise<number> => {
  const body = await paymentRequest(auth, '/api/user/amount', { amount })
  return Number(body.data)
}

export const createEpayOrder = async (auth: StoredAuth, amount: number, paymentMethod: string): Promise<EpayOrder> => {
  const body = await paymentRequest(auth, '/api/user/pay', { amount, payment_method: paymentMethod })
  const params = (body.data ?? {}) as Record<string, string>
  if (!body.url || !params.out_trade_no) throw new ApiError('支付下单响应不完整')
  return { url: body.url, params, tradeNo: params.out_trade_no }
}

/** 把易支付参数以表单 POST 到收银台；target 为窗口名，打开失败时用 _self */
export const submitEpayForm = (order: EpayOrder, target: string): void => {
  const form = document.createElement('form')
  form.action = order.url
  form.method = 'POST'
  form.target = target
  for (const [name, value] of Object.entries(order.params)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = String(value)
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

type TopUpPage = { items?: { trade_no: string; status: TopUpStatus }[] }

/** 查自己的充值订单状态；查不到返回 null */
export const fetchTopUpStatus = async (auth: StoredAuth, tradeNo: string): Promise<TopUpStatus | null> => {
  const page = await request<TopUpPage>(
    auth.server,
    `/api/user/topup/self?p=1&page_size=10&keyword=${encodeURIComponent(tradeNo)}`,
    { method: 'GET', bearer: auth.token }
  )
  return page?.items?.find((item) => item.trade_no === tradeNo)?.status ?? null
}

/** 兑换成功返回到账额度（quota 单位） */
export const redeemCode = async (auth: StoredAuth, key: string): Promise<number> => {
  try {
    return await request<number>(auth.server, '/api/user/topup', { method: 'POST', bearer: auth.token, json: { key } })
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) throw new ApiError(SCOPE_DENIED_MESSAGE, 403)
    throw error
  }
}
