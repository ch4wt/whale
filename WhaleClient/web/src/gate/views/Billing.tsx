import { useEffect, useState } from 'react'

import { loadAuth } from '../api/auth.js'
import { request } from '../api/http.js'

type TopUp = {
  id: number
  trade_no: string
  amount: number
  money: number
  payment_method: string
  create_time: number
  status: string
}

const statusText = (status: string) => {
  if (status === 'success') return '成功'
  if (status === 'pending') return '待支付'
  if (status === 'cancelled' || status === 'canceled') return '已取消'
  return status || '—'
}

export const BillingContent = () => {
  const [rows, setRows] = useState<TopUp[]>([])
  const [tab, setTab] = useState<'topup' | 'gift'>('topup')
  const [self, setSelf] = useState<{ quota?: number; used_quota?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const auth = loadAuth()
    if (!auth) return
    request<{ quota?: number; used_quota?: number }>(auth.server, '/api/user/self', {
      method: 'GET',
      bearer: auth.token,
    })
      .then((me) => setSelf(me as { quota?: number; used_quota?: number }))
      .catch(() => undefined)
    request<{ data?: { items?: TopUp[] }; items?: TopUp[] }>(auth.server, '/api/user/topup/self?p=1&size=50', {
      method: 'GET',
      bearer: auth.token,
    })
      .then((res) => {
        const items = (res as { data?: { items?: TopUp[] } }).data?.items ?? (res as { items?: TopUp[] }).items ?? []
        setRows(items)
      })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className='bill-page'>
        <div className='bill-head'>
          <h2>账单</h2>
          <div className='bill-links'>
            <button type='button'>退款管理</button>
            <button type='button'>发票管理</button>
          </div>
        </div>
        <div className='bill-tabs'>
          <button type='button' className={tab === 'topup' ? 'on' : ''} onClick={() => setTab('topup')}>
            充值账单
          </button>
          <button type='button' className={tab === 'gift' ? 'on' : ''} onClick={() => setTab('gift')}>
            赠送账单
          </button>
        </div>
        {error ? <div className='bill-error'>{error}</div> : null}
        {tab === 'gift' ? (
          <div className='bill-gift'>
            <p>新用户赠金：¥{((68000 / 500000 * 7.3) * 0).toFixed(2)}</p>
            <p className='bill-tip'>
              赠送记录暂未单独记账，当前赠金体现在账户余额里。需要明细请后续在后台补账。
            </p>
          </div>
        ) : loading ? (
          <div className='bill-empty'>加载中…</div>
        ) : rows.length === 0 ? (
          <div className='bill-empty'>还没有充值记录</div>
        ) : (
          <table className='bill-table'>
            <thead>
              <tr>
                <th>订单编号</th>
                <th>状态</th>
                <th>金额</th>
                <th>支付方式</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className='mono'>{row.trade_no}</td>
                  <td>{statusText(row.status)}</td>
                  <td>¥{Number(row.money ?? 0).toFixed(2)}</td>
                  <td>{row.payment_method || '—'}</td>
                  <td>{new Date(row.create_time * 1000).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}
