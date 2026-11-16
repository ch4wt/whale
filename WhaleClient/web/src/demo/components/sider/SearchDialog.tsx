import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SearchDialog.module.css'

/** 会话搜索：居中大框，同时搜标题和正文 */
export const SearchDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const results = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return []
    const cache = useChatStore.getState().sessionCache
    return sessions
      .map((item) => {
        const titleHit = (item.title || '').toLowerCase().includes(value)
        const detail = cache[item.id]
        const message = detail?.messages.find(
          (entry) => typeof entry.content === 'string' && entry.content.toLowerCase().includes(value)
        )
        if (!titleHit && !message) return null
        const content = message && typeof message.content === 'string' ? message.content : ''
        const index = content.toLowerCase().indexOf(value)
        const snippet =
          content && index >= 0
            ? `${index > 14 ? '…' : ''}${content.slice(Math.max(0, index - 14), index + 30)}…`
            : content.slice(0, 44)
        return { id: item.id, title: item.title || t('untitledChat'), snippet }
      })
      .filter((item): item is { id: string; title: string; snippet: string } => item !== null)
  }, [sessions, query, t])

  return (
    <div className={styles.mask} onClick={onClose}>
      <div className={styles.panel} onClick={(event) => event.stopPropagation()}>
        <div className={styles.searchRow}>
          <span className={styles.icon}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12.2 12.2 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder="搜索对话内容..."
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className={styles.cancel} onClick={onClose} aria-label="关闭搜索">
            ×
          </button>
        </div>

        {query.trim() ? (
        <div className={styles.results}>
          {query.trim() === '' ? (
            <div className={styles.hint}>输入关键词，搜索标题和消息内容</div>
          ) : results.length === 0 ? (
            <div className={styles.hint}>没有匹配的对话</div>
          ) : (
            results.map((item) => (
              <div
                key={item.id}
                className={styles.result}
                onClick={() => {
                  selectSession(item.id)
                  closeMobileSider()
                  onClose()
                }}
              >
                <div className={styles.title}>{item.title}</div>
                {item.snippet ? <div className={styles.snippet}>{item.snippet}</div> : null}
              </div>
            ))
          )}
        </div>
        ) : null}
      </div>
    </div>
  )
}
