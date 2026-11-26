import { IOS_HINT, isIOS } from '../iosNotice.js'
import { useMemo, useState } from 'react'
import qrcode from '../../vendor/qrcode-generator.js'

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

const AppDialog = ({ onClose }: { onClose: () => void }) => {
  const url = `${location.origin}/download/whalegirl.apk`
  const pageUrl = `${location.origin}/#chat`
  const iosBlocked = isIOS()
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(pageUrl)
    qr.make()
    return qr.createSvgTag({ cellSize: 5, margin: 2 })
  }, [pageUrl])
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

  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  const desktop = !android && !iosBlocked

  return (
    <div className="lp-mask" onClick={onClose}>
      <div className="lp-dialog lp-dialog-wide" onClick={(event) => event.stopPropagation()}>
        <div className="lp-dialog-title">装到手机</div>
        <div className="lp-dialog-sub">按你的手机选一种</div>

        <div className="lp-platform">
          <div className="lp-platform-head">安卓手机</div>
          <a className="lp-download" href={url} download>
            下载 小虎鲸 APK（约 2 MB）
          </a>
        </div>

        <div className="lp-platform">
          <div className="lp-platform-head">iPhone</div>
          <ol className="lp-steps">
            <li>用 Safari 打开本页（微信里打不开）</li>
            <li>点底部「分享」→「添加到主屏幕」</li>
            <li>右上角点「添加」，桌面出现小虎鲸图标</li>
            <li>点图标即全屏使用，和 App 一样</li>
          </ol>
        </div>

        {desktop ? (
          <div className="lp-platform">
            <div className="lp-platform-head">在电脑上，扫码装到手机</div>
            <div className="lp-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        ) : null}

        <div className="lp-copy">
          <input readOnly value={pageUrl} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" onClick={copy}>
            {copied ? '已复制' : '复制链接'}
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
