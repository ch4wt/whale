/*
Copyright (C) 2023-2026 QuantumNous
*/
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

type Platform = {
  key_masked: string
  base_url: string
  upstream_topped_up: number
  upstream_balance: number
  upstream_used: number
  user_paid: number
  user_used: number
  user_balance: number
  user_gift: number
  gross_profit: number
  net_profit: number
}

type UserRow = {
  id: number
  username: string
  role: number
  status: number
  request_count: number
  topped_up: number
  balance: number
  used: number
  total: number
}

type Settings = { new_user_gift: number; group_ratio: number; log_chat_content: boolean }

type ChatLog = {
  id: number
  user_id: number
  username: string
  model_name: string
  quota: number
  cost: number
  content: string
  created_at: number
}

type PlatformKey = {
  id: number
  name: string
  base_url: string
  key_masked: string
  status: number
  balance: number
  models: string
}

const money = (value: number) => `¥${(value ?? 0).toFixed(2)}`

const parseMessages = (raw: string): { role: string; content: string }[] => {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.content === 'string')
        .map((item) => ({ role: String(item.role ?? ''), content: item.content }))
    }
  } catch {
    // 不是 JSON 就按纯文本展示
  }
  return [{ role: '', content: raw }]
}

type UserDetail = {
  id: number
  username: string
  display_name: string
  email: string
  role: number
  status: number
  group: string
  register_type: string
  created_at: number
  last_login_at: number
  quota: number
  used: number
  request_count: number
  audits: { action: string; content: string; ip: string; created_at: number }[]
}

const USER_COLUMNS = ['账号', '充值', '赠金', '消耗', '剩余', '操作']

async function getJson<T>(path: string): Promise<T> {
  const res = await api.get(path, { skipErrorHandler: true })
  return res.data as T
}

function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-muted-foreground text-xs font-normal'>
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-semibold'>{props.value}</div>
        {props.hint ? (
          <div className='text-muted-foreground mt-1 text-xs'>{props.hint}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function LiteAdmin() {
  const currentUser = useAuthStore((state) => state.auth.user)
  if (currentUser && currentUser.role < 100) {
    return (
      <div className='flex min-h-screen items-center justify-center p-6'>
        <Card className='w-full max-w-md'>
          <CardHeader>
            <CardTitle className='text-sm'>需要管理员账号</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <p className='text-muted-foreground'>
              当前登录的是普通用户「{currentUser.username}」。这个后台只对管理员开放。
            </p>
            <Button
              onClick={() => {
                window.location.href = '/sign-in'
              }}
            >
              换个账号登录
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const [tab, setTab] = useState<'platform' | 'users' | 'logs' | 'user-logs' | 'user-detail' | 'settings'>('platform')
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [settings, setSettings] = useState<Settings>({ new_user_gift: 1, group_ratio: 1.5, log_chat_content: false })
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([])
  const [logUserId, setLogUserId] = useState<number | null>(null)
  const [logUserName, setLogUserName] = useState('')
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [colWidths, setColWidths] = useState<number[]>([150, 100, 120, 100, 100, 110])
  const [giftEditing, setGiftEditing] = useState<number | null>(null)
  const [giftDraft, setGiftDraft] = useState('')
  const [keys, setKeys] = useState<PlatformKey[]>([])
  const [editingKey, setEditingKey] = useState<PlatformKey | 'new' | null>(null)
  const [keyForm, setKeyForm] = useState({ name: '', base_url: 'https://api.deepseek.com', key: '' })
  const [giftInput, setGiftInput] = useState('1')
  const [ratioInput, setRatioInput] = useState('1.5')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const reload = async () => {
    setError('')
    try {
      const [overview, keyData, fundData, settingData] = await Promise.all([
        getJson<{ data: Platform }>('/api/user/platform/overview'),
        getJson<{ data: { items: PlatformKey[] } }>('/api/user/platform/keys'),
        getJson<{ data: { users: UserRow[] } }>('/api/user/funds/overview'),
        getJson<{ data: Settings }>('/api/user/platform/settings'),
      ])
      setPlatform(overview?.data ?? null)
      setKeys(keyData?.data?.items ?? [])
      const logQuery = logUserId ? `?limit=50&user_id=${logUserId}` : '?limit=50'
      // logUserId 来自闭包，切换时 reload 立即取最新值
      const logData = await getJson<{ data: { items: ChatLog[] } }>(
        `/api/user/platform/chat-logs${logQuery}`
      )
      setChatLogs(logData?.data?.items ?? [])
      setUsers(fundData?.data?.users ?? [])
      if (settingData?.data) {
        setSettings(settingData.data)
        setGiftInput(String(settingData.data.new_user_gift))
        setRatioInput(String(settingData.data.group_ratio))
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('tab') === 'user-logs') {
      const uid = Number(params.get('user_id') ?? 0)
      if (uid > 0) {
        setLogUserId(uid)
        setLogUserName(params.get('name') ?? '')
        setTab('user-logs')
      }
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [])

  const saveKey = async () => {
    setError('')
    try {
      await api.post('/api/user/platform/keys', {
        id: editingKey && editingKey !== 'new' ? editingKey.id : 0,
        name: keyForm.name,
        base_url: keyForm.base_url,
        key: keyForm.key,
        status: 1,
      })
      setEditingKey(null)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const removeKey = async (id: number) => {
    if (!window.confirm('删除这个 Key？')) return
    await api.delete(`/api/user/platform/keys/${id}`)
    await reload()
  }

  const saveGift = async (row: UserRow) => {
    const next = Number(giftDraft)
    if (!Number.isFinite(next) || next < 0) {
      setGiftEditing(null)
      return
    }
    const delta = Math.round((next - giftOf(row)) * 100) / 100
    setGiftEditing(null)
    if (delta === 0) return
    await api.post('/api/user/quota/add', { user_id: row.id, amount: delta })
    await reload()
  }

  const saveSettings = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await api.put('/api/user/platform/settings', {
        new_user_gift: Number(giftInput),
        group_ratio: Number(ratioInput),
      })
      setMessage('已保存，立即生效')
      await reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const normalUsers = users.filter((row) => row.role < 100)
  const giftOf = (row: UserRow) => Math.max(0, (row.total ?? 0) - (row.topped_up ?? 0))

  return (
    <div className='bg-background flex min-h-screen'>
      <aside className='hidden w-56 shrink-0 flex-col gap-1 border-r p-3 sm:flex'>
        <div className='mb-3 flex items-center gap-2 px-2 py-1'>
          <img src='/whale-logo.png' alt='' className='size-6 rounded-md' />
          <span className='text-sm font-semibold'>小虎鲸管理后台</span>
        </div>
        {(
          [
            ['platform', '平台总量'],
            ['users', '用户'],
            ['logs', '聊天日志'],
            ['settings', '设置'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type='button'
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'bg-accent text-accent-foreground rounded-md px-3 py-2 text-left text-sm'
                : 'text-muted-foreground hover:bg-accent/60 rounded-md px-3 py-2 text-left text-sm'
            }
          >
            {label}
          </button>
        ))}
      </aside>

      <div className='flex min-w-0 flex-1 flex-col'>
        <header className='flex items-center gap-2 border-b px-4 py-3 sm:px-6'>
          <img src='/whale-logo.png' alt='' className='size-6 rounded-md sm:hidden' />
          <span className='text-sm font-semibold sm:hidden'>小虎鲸</span>
          <div className='ml-auto'>
            <a
              href='/dashboard/overview'
              className='border-border hover:bg-accent rounded-md border px-3 py-1.5 text-xs'
            >
              切换旧版
            </a>
          </div>
        </header>

        <main className='min-w-0 flex-1 space-y-4 p-4 sm:p-6'>
          {error ? <div className='text-destructive text-sm'>{error}</div> : null}

          {tab === 'platform' ? (
            <>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between'>
                  <CardTitle className='text-sm'>平台 Key</CardTitle>
                  <Button
                    size='sm'
                    onClick={() => {
                      setEditingKey('new')
                      setKeyForm({ name: '', base_url: 'https://api.deepseek.com', key: '' })
                    }}
                  >
                    添加 Key
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>名称</TableHead>
                        <TableHead>接口地址</TableHead>
                        <TableHead>Key</TableHead>
                        <TableHead className='text-right'>余额</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {keys.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className='text-muted-foreground'>
                            还没有 Key
                          </TableCell>
                        </TableRow>
                      ) : (
                        keys.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell className='text-xs'>{row.base_url}</TableCell>
                            <TableCell className='font-mono text-xs'>{row.key_masked}</TableCell>
                            <TableCell className='text-right'>{money(row.balance)}</TableCell>
                            <TableCell className='text-right'>
                              <div className='flex justify-end gap-2'>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  onClick={() => {
                                    setEditingKey(row)
                                    setKeyForm({ name: row.name, base_url: row.base_url, key: '' })
                                  }}
                                >
                                  编辑
                                </Button>
                                <Button size='sm' variant='ghost' onClick={() => removeKey(row.id)}>
                                  删除
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>

                <StatCard
                  label='累计充值金额'
                  value={money(platform?.upstream_topped_up ?? 0)}
                  hint='只在余额上涨时增加'
                />
                <StatCard
                  label='累计消耗金额'
                  value={money(platform?.upstream_used ?? 0)}
                />
                <StatCard
                  label='平台当前余额'
                  value={money(platform?.upstream_balance ?? 0)}
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                <StatCard label='用户总充值' value={money(platform?.user_paid ?? 0)} />
                <StatCard label='用户总消耗' value={money(platform?.user_used ?? 0)} />
                <StatCard
                  label='总剩余（预售款）'
                  value={money(platform?.user_balance ?? 0)}
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                <StatCard label='总毛利' value={money(platform?.gross_profit ?? 0)} />
                <StatCard label='总赠金' value={money(platform?.user_gift ?? 0)} />
                <StatCard
                  label='总毛利 − 总赠金'
                  value={money(platform?.net_profit ?? 0)}
                />
              </div>
            </>
          ) : null}

          {tab === 'users' ? (
            <Card>
              <CardContent className='pt-4'>
                <div className='overflow-x-auto'>
                  <table className='w-full caption-bottom text-sm' style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      {colWidths.map((width, index) => (
                        <col key={index} style={{ width }} />
                      ))}
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        {USER_COLUMNS.map((label, index) => (
                          <TableHead
                            key={label}
                            className={
                              index === 0
                                ? 'relative border-r text-center'
                                : 'relative border-r text-center last:border-r-0'
                            }
                          >
                            {label}
                            {index < USER_COLUMNS.length - 1 ? (
                              <span
                                className='bg-border hover:bg-primary absolute top-0 right-0 h-full w-0.5 cursor-col-resize select-none transition-colors'
                                onMouseDown={(event) => {
                                  event.preventDefault()
                                  const startX = event.clientX
                                  const startWidth = colWidths[index]
                                  const onMove = (moveEvent: MouseEvent) => {
                                    const next = Math.max(80, startWidth + moveEvent.clientX - startX)
                                    setColWidths((current) =>
                                      current.map((value, position) =>
                                        position === index ? next : value
                                      )
                                    )
                                  }
                                  const onUp = () => {
                                    window.removeEventListener('mousemove', onMove)
                                    window.removeEventListener('mouseup', onUp)
                                  }
                                  window.addEventListener('mousemove', onMove)
                                  window.addEventListener('mouseup', onUp)
                                }}
                              />
                            ) : null}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {normalUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className='text-muted-foreground'>
                            还没有用户
                          </TableCell>
                        </TableRow>
                      ) : (
                        normalUsers.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className='truncate text-center'>
                              <button
                                type='button'
                                className='hover:text-foreground text-muted-foreground underline-offset-4 hover:underline'
                                onClick={async () => {
                                  const data = await getJson<{ data: UserDetail }>(
                                    `/api/user/platform/user/${row.id}`
                                  )
                                  setDetail(data?.data ?? null)
                                  setTab('user-detail')
                                }}
                              >
                                {row.username}
                              </button>
                            </TableCell>
                            <TableCell className='text-center'>{money(row.topped_up)}</TableCell>
                            <TableCell className='text-center'>
                              {giftEditing === row.id ? (
                                <div className='flex items-center justify-center gap-1'>
                                  <Input
                                    autoFocus
                                    type='number'
                                    step='0.01'
                                    min='0'
                                    className='h-7 w-24 text-right'
                                    value={giftDraft}
                                    onChange={(event) => setGiftDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Escape') setGiftEditing(null)
                                      if (event.key === 'Enter') void saveGift(row)
                                    }}
                                  />
                                  <button
                                    type='button'
                                    className='text-primary px-1 text-sm'
                                    title='保存'
                                    onClick={() => void saveGift(row)}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type='button'
                                    className='text-muted-foreground px-1 text-sm'
                                    title='取消'
                                    onClick={() => setGiftEditing(null)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div className='flex items-center justify-center gap-1'>
                                  <span>{money(giftOf(row))}</span>
                                  <button
                                    type='button'
                                    className='text-muted-foreground hover:text-foreground px-1'
                                    title='修改赠金'
                                    onClick={() => {
                                      setGiftEditing(row.id)
                                      setGiftDraft(giftOf(row).toFixed(2))
                                    }}
                                  >
                                    ✎
                                  </button>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className='text-center'>{money(row.used)}</TableCell>
                            <TableCell className='text-center'>{money(row.balance)}</TableCell>
                            <TableCell className='text-center'>
                              <Button
                                size='sm'
                                variant='ghost'
                                onClick={() => {
                                  window.location.href = `/lite?tab=user-logs&user_id=${row.id}&name=${encodeURIComponent(row.username)}`
                                }}
                              >
                                聊天记录
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Dialog open={Boolean(editingKey)} onOpenChange={(open) => !open && setEditingKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingKey === 'new' ? '添加 Key' : '编辑 Key'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <Input
              placeholder='名称'
              value={keyForm.name}
              onChange={(event) => setKeyForm({ ...keyForm, name: event.target.value })}
            />
            <Input
              placeholder='接口地址'
              value={keyForm.base_url}
              onChange={(event) => setKeyForm({ ...keyForm, base_url: event.target.value })}
            />
            <Input
              placeholder={editingKey === 'new' ? 'Key（sk-...）' : '留空则不修改'}
              value={keyForm.key}
              onChange={(event) => setKeyForm({ ...keyForm, key: event.target.value })}
            />
            <Button onClick={saveKey}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>

      {tab === 'user-detail' ? (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle className='text-sm'>{detail?.username ?? '用户'} 的资料</CardTitle>
            <Button size='sm' variant='outline' onClick={() => setTab('users')}>
              返回用户列表
            </Button>
          </CardHeader>
          <CardContent className='space-y-4'>
            {detail ? (
              <>
                <div className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'>
                  {[
                    ['用户名', detail.username],
                    ['显示名', detail.display_name || '—'],
                    ['邮箱', detail.email || '—'],
                    ['注册方式', detail.register_type],
                    ['角色', detail.role >= 100 ? '管理员' : '普通用户'],
                    ['状态', detail.status === 1 ? '正常' : '已禁用'],
                    ['分组', detail.group || 'default'],
                    ['注册时间', new Date(detail.created_at * 1000).toLocaleString('zh-CN')],
                    ['最近登录', detail.last_login_at ? new Date(detail.last_login_at * 1000).toLocaleString('zh-CN') : '—'],
                    ['余额', money(detail.quota)],
                    ['已消耗', money(detail.used)],
                    ['请求次数', String(detail.request_count)],
                  ].map(([label, value]) => (
                    <div key={label} className='rounded-lg border p-2'>
                      <div className='text-muted-foreground text-xs'>{label}</div>
                      <div className='mt-0.5 break-words'>{value}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className='mb-2 text-sm font-medium'>操作记录</div>
                  <div className='max-h-80 space-y-2 overflow-y-auto text-xs'>
                    {detail.audits.length === 0 ? (
                      <p className='text-muted-foreground'>没有记录</p>
                    ) : (
                      detail.audits.map((item, index) => (
                        <div key={index} className='flex gap-2 border-b pb-2'>
                          <span className='text-muted-foreground w-40 shrink-0'>
                            {new Date(item.created_at * 1000).toLocaleString('zh-CN')}
                          </span>
                          <span className='w-40 shrink-0 font-mono'>{item.action || '—'}</span>
                          <span className='break-words'>{item.content || '—'}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>加载中…</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'user-logs' ? (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle className='text-sm'>
              {logUserName || `用户 ${logUserId}`} 的聊天记录
            </CardTitle>
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                setLogUserId(null)
                setLogUserName('')
                setTab('users')
              }}
            >
              返回用户列表
            </Button>
          </CardHeader>
          <CardContent>
            {chatLogs.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                没有记录。可能是「记录聊天内容」没开，或这位用户还没有对话。
              </p>
            ) : (
              <div className='space-y-4'>
                {chatLogs.map((row) => (
                  <div key={row.id} className='rounded-lg border p-3'>
                    <div className='text-muted-foreground mb-2 flex justify-between text-xs'>
                      <span>{new Date(row.created_at * 1000).toLocaleString('zh-CN')}</span>
                      <span>
                        {row.model_name} · {money(row.cost)}
                      </span>
                    </div>
                    <div className='space-y-2 text-sm'>
                      {parseMessages(row.content).map((message, index) => (
                        <div
                          key={index}
                          className={
                            message.role === 'assistant'
                              ? 'flex items-start gap-2'
                              : 'flex items-start justify-end gap-2'
                          }
                        >
                          {message.role === 'assistant' ? (
                            <span className='text-muted-foreground w-12 shrink-0 pt-1.5 text-xs'>
                              小虎鲸
                            </span>
                          ) : null}
                          <div
                            className={
                              message.role === 'assistant'
                                ? 'bg-muted max-w-[70%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words'
                                : 'bg-primary text-primary-foreground max-w-[70%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words'
                            }
                          >
                            {message.content}
                          </div>
                          {message.role === 'assistant' ? null : (
                            <span className='text-muted-foreground w-12 shrink-0 pt-1.5 text-xs'>
                              你
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'logs' ? (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle className='text-sm'>最近 50 条对话</CardTitle>
            <select
              className='bg-background h-8 rounded-md border px-2 text-sm'
              value={logUserId ?? ''}
              onChange={async (event) => {
                const value = event.target.value
                const uid = value ? Number(value) : null
                setLogUserId(uid)
                const query = uid ? `?limit=50&user_id=${uid}` : '?limit=50'
                const data = await getJson<{ data: { items: ChatLog[] } }>(
                  `/api/user/platform/chat-logs${query}`
                )
                setChatLogs(data?.data?.items ?? [])
              }}
            >
              <option value=''>全部用户</option>
              {normalUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </CardHeader>
          <CardContent>
            {settings.log_chat_content ? null : (
              <p className='text-muted-foreground mb-3 text-xs'>
                当前没有记录聊天内容。到「设置」里打开「记录聊天内容」。
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead className='text-right'>消耗</TableHead>
                  <TableHead>内容</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chatLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className='text-muted-foreground'>
                      还没有日志
                    </TableCell>
                  </TableRow>
                ) : (
                  chatLogs.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className='text-xs'>
                        {new Date(row.created_at * 1000).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell>{row.username || row.user_id}</TableCell>
                      <TableCell className='text-xs'>{row.model_name}</TableCell>
                      <TableCell className='text-right'>{money(row.cost)}</TableCell>
                      <TableCell className='max-w-[520px] text-xs'>
                        <div className='space-y-1'>
                          {parseMessages(row.content).map((message, index) => (
                            <div key={index} className='flex gap-1'>
                              <span className='text-muted-foreground shrink-0'>
                                {message.role === 'assistant' ? '小虎鲸：' : '你：'}
                              </span>
                              <span className='line-clamp-2 break-words'>{message.content}</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'settings' ? (
            <Card className='max-w-xl'>
              <CardHeader>
                <CardTitle className='text-sm'>平台设置</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='space-y-2'>
                  <div className='text-xs text-muted-foreground'>新注册用户赠金（元）</div>
                  <Input
                    value={giftInput}
                    inputMode='decimal'
                    onChange={(event) => setGiftInput(event.target.value)}
                  />
                </div>
                <div className='space-y-2'>
                  <div className='text-xs text-muted-foreground'>用户消耗倍率</div>
                  <Input
                    value={ratioInput}
                    inputMode='decimal'
                    onChange={(event) => setRatioInput(event.target.value)}
                  />
                  <div className='text-xs text-muted-foreground'>
                    官方成本 1 元，用户扣 {ratioInput || '—'} 元
                  </div>
                </div>
                {message ? <div className='text-xs text-emerald-500'>{message}</div> : null}
                <Button onClick={saveSettings} disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </Button>
                <div className='text-xs text-muted-foreground'>
                  当前生效值：赠金 {money(settings.new_user_gift)}／倍率 {settings.group_ratio}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </main>
      </div>
    </div>
  )
}
