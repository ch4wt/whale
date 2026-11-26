import { IOS_HINT, isIOS } from '../iosNotice.js'
import { useMemo, useState } from 'react'
import qrcode from '../../vendor/qrcode-generator.js'

/** 悬停菜单项时出现的下载二维码，鼠标移开即消失 */
export const DownloadPopover = () => {
  const url = `${location.origin}/download/whalegirl.apk`
  const iosBlocked = isIOS()
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    return qr.createSvgTag({ cellSize: 6, margin: 2 })
  }, [url])

  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // 剪贴板被拒绝时仍然提示，用户可手动选中
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="dl-popover">
      <div className="dl-qr">
        <div className="dl-qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
        <img className="dl-qr-logo" src="brand-avatar.png" alt="" />
      </div>
      <div className="dl-caption">扫码下载 Whale Girl App</div>
      <div className="dl-copy">
        <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}
