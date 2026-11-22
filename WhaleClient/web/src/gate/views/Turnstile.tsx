/**
 * Cloudflare Turnstile 人机验证组件，参照 new-api 主站 web/src/components/turnstile.tsx。
 * token 只能用一次：每次提交后由父组件换 key 重新挂载，拿新的 token。
 */
import { useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptLoading: Promise<TurnstileApi> | null = null

/** 整个页面只加载一次脚本；加载失败允许下次重试 */
const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('人机验证脚本加载异常')))
    script.onerror = () => {
      script.remove()
      scriptLoading = null
      reject(new Error('人机验证脚本加载失败，请检查网络'))
    }
    document.head.appendChild(script)
  })
  return scriptLoading
}

type TurnstileProps = {
  siteKey: string
  onVerify: (token: string) => void
  /** token 过期、验证出错时调用，父组件应清空 token */
  onExpire: () => void
  onError?: (message: string) => void
}

export const Turnstile = ({ siteKey, onVerify, onExpire, onError }: TurnstileProps) => {
  const ref = useRef<HTMLDivElement | null>(null)
  // 回调放进 ref，父组件重渲染不会导致重新渲染验证框
  const callbacks = useRef({ onVerify, onExpire, onError })
  callbacks.current = { onVerify, onExpire, onError }

  useEffect(() => {
    let alive = true
    let widgetId: string | null = null

    loadTurnstile()
      .then((api) => {
        if (!alive || !ref.current) return
        widgetId = api.render(ref.current, {
          sitekey: siteKey,
          callback: (token: string) => callbacks.current.onVerify(token),
          'expired-callback': () => callbacks.current.onExpire(),
          'error-callback': () => {
            callbacks.current.onExpire()
            callbacks.current.onError?.('人机验证失败，请刷新后重试')
          },
        })
      })
      .catch((e: Error) => alive && callbacks.current.onError?.(e.message))

    return () => {
      alive = false
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId)
        } catch {
          // 节点已卸载时 remove 可能抛错，忽略即可
        }
      }
    }
  }, [siteKey])

  return <div ref={ref} className="turnstile" />
}
