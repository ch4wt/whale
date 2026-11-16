/** 置顶会话：只存在本机，不写数据库 */
const KEY = 'whaleclient:pinned'

export const readPinned = (): Set<string> => {
  try {
    const raw = localStorage.getItem(KEY)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export const writePinned = (ids: Set<string>): void => {
  localStorage.setItem(KEY, JSON.stringify([...ids]))
}

export const isPinned = (id: string): boolean => readPinned().has(id)

export const togglePin = (id: string): boolean => {
  const pinned = readPinned()
  const next = !pinned.has(id)
  if (next) pinned.add(id)
  else pinned.delete(id)
  writePinned(pinned)
  return next
}
