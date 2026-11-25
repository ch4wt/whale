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

type Settings = { new_user_gift: number; group_ratio: number }

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
  const [tab, setTab] = useState<'platform' | 'users' | 'settings'>('platform')
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [settings, setSettings] = useState<Settings>({ new_user_gift: 1, group_ratio: 1.5 })
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>账号</TableHead>
                      <TableHead className='text-right'>充值</TableHead>
                      <TableHead className='text-right'>赠金</TableHead>
                      <TableHead className='text-right'>消耗</TableHead>
                      <TableHead className='text-right'>剩余</TableHead>
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
                          <TableCell>{row.username}</TableCell>
                          <TableCell className='text-right'>{money(row.topped_up)}</TableCell>
                          <TableCell className='text-right'>{money(giftOf(row))}</TableCell>
                          <TableCell className='text-right'>{money(row.used)}</TableCell>
                          <TableCell className='text-right'>{money(row.balance)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
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
