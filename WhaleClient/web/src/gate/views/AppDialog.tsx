import { useMemo, useState } from 'react'
import qrcode from '../../vendor/qrcode-generator.js'

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

const AppDialog = ({ onClose }: { onClose: () => void }) => {
  const url = `${location.origin}/download/whalegirl.apk`
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    return qr.createSvgTag({ cellSize: 5, margin: 2 })
  }, [url])
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="lp-mask" onClick={onClose}>
      <div className="lp-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="lp-dialog-title">用手机装 App</div>
        <div className="lp-dialog-sub">安卓手机扫码，或用链接发到手机</div>
        <div className="lp-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="lp-copy">
          <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" onClick={copy}>
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <button type="button" className="lp-dialog-close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}


export { AppDialog, isMobile }
