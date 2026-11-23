/**
 * new-api 返回的错误是英文原文，并附带 message_key / message_params，主站用 zh.json 翻译。
 * zh.json 太大，这里只收录客户端会遇到的那些，译文与主站 zh.json 保持一致。
 * 查不到的 key 原样显示英文，不丢信息。
 */
const ZH: Record<string, string> = {
  // 登录、注册
  'Password login has been disabled by administrator': '管理员关闭了密码登录',
  'Username or password is incorrect, or user has been banned': '用户名或密码错误，或用户已被封禁',
  'User has been banned': '用户已被封禁',
  'User has been deleted': '用户已注销',
  'New user registration has been disabled by administrator': '管理员关闭了新用户注册',
  'Password registration has been disabled by administrator, please use third-party account verification':
    '管理员关闭了通过密码进行注册，请使用第三方账户验证的形式进行注册',
  'Invalid input {{error}}': '输入不合法 {{error}}',
  'Email verification is enabled, please enter email address and verification code':
    '管理员开启了邮箱验证，请输入邮箱地址和验证码',
  'Verification code is incorrect or has expired': '验证码错误或已过期',
  'Email address is already in use': '邮箱地址已被占用',
  'Username already exists or has been deleted': '用户名已存在，或已注销',
  'User registration failed or user ID retrieval failed': '用户注册失败或用户ID获取失败',
  'Database error, please contact the administrator': '数据库出错，请联系管理员',
  '{{provider}} login and registration has not been enabled by administrator': '管理员未开启通过 {{provider}} 登录以及注册',
  'Invalid parameters': '无效的参数',
  'Invalid request': '无效的请求',

  // 人机验证
  'Turnstile token is empty': '请先完成人机验证',
  'Turnstile verification failed, please refresh and try again!': '人机验证失败，请刷新后重试',

  // 两步验证、安全验证、长期令牌
  'Verification failed. Please try again.': '验证失败，请重试。',
  'Verification flow expired': '验证流程已过期',
  'Two-factor authentication is temporarily locked.': '两步验证已暂时锁定。',
  'Two-factor authentication is not enabled.': '两步验证尚未启用。',
  'This verification method is currently unavailable.': '此验证方式当前不可用。',
  'This verification method is not allowed for this action.': '此操作不允许使用该验证方式。',
  'The current sign-in method does not support security verification': '当前认证方式不支持安全验证',
  'Password authentication is disabled.': '密码认证已禁用。',
  'Please try again later.': '请稍后再试。',
  'You can create at most {{count}} access tokens': '最多可创建 {{count}} 个访问令牌',
  'You cannot grant one or more of these permissions.': '你无法授予其中一项或多项权限。',

  // 鉴权
  'Unauthorized, insufficient privileges': '无权进行此操作，权限不足',
  'Unauthorized, invalid user info': '无权进行此操作，用户信息无效',
  'Unauthorized, the access token has expired': '登录已过期，请重新登录',
  'Unauthorized, not logged in and no access token provided': '未登录，请先登录',
  'Unauthorized, invalid access token': '登录凭证无效，请重新登录',
  'The access token lacks the required permission: {{scope}}': '访问令牌缺少所需权限：{{scope}}',

  // 充值、兑换码
  'Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them.':
    '支付、兑换码、订阅计划和邀请返利功能已禁用。管理员需先确认合规声明后方可启用。',
  'Top-up is processing, please try again later': '充值处理中，请稍后重试',
  'Redemption failed, please try again later': '兑换失败，请稍后重试',
  'Top-up quota exceeds the range the system can represent': '充值额度超出系统可表示范围',
  'Top-up quota must be greater than 0': '充值额度必须大于 0',
  'Top-up amount cannot exceed {{max}}': '充值数量不能大于 {{max}}',
  'Invalid top-up amount': '充值数量无效',
  'Top-up amount cannot be less than {{min}}': '充值数量不能小于 {{min}}',
  'Failed to get the user group': '获取用户分组失败',
  'Payment amount is too low': '充值金额过低',
  'Payment method does not exist': '支付方式不存在',
  'Payment information has not been configured by administrator': '当前管理员未配置支付信息',
  'Failed to start payment': '拉起支付失败',
  'Failed to create order': '创建订单失败',
}

/** 把后端的 message_key 翻成中文；没有收录的返回 undefined，由调用方回退到原文 */
export const translateServerMessage = (key: string | undefined, params?: Record<string, unknown>): string | undefined => {
  const template = key ? ZH[key] : undefined
  if (!template) return undefined
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match
  )
}

/** 429 没有响应体，只有 Retry-After（秒） */
export const rateLimitMessage = (retryAfter: string | null): string => {
  const seconds = Number(retryAfter)
  if (!Number.isFinite(seconds) || seconds <= 0) return '操作太频繁，请稍后再试'
  if (seconds < 60) return `操作太频繁，请 ${Math.ceil(seconds)} 秒后再试`
  return `操作太频繁，请 ${Math.ceil(seconds / 60)} 分钟后再试`
}
