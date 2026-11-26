import { IOS_HINT, isIOS } from '../iosNotice.js'
import { useMemo, useState } from 'react'
import qrcode from '../../vendor/qrcode-generator.js'

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

const AppDialog = ({ onClose }: { onClose: () => void }) => {
  const url = `${location.origin}/download/whalegirl.apk`
  const iosBlocked = isIOS()
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

  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  const pageUrl = `${location.origin}/#chat`

  return (
    <div className="lp-mask" onClick={onClose}>
      <div className="lp-dialog" onClick={(event) => event.stopPropagation()}>
        {iosBlocked ? (
          <>
            <div className="lp-dialog-title">装到 iPhone</div>
            <div className="lp-dialog-sub">不用下载文件，两步完成</div>
            <ol className="lp-steps">
              <li>用 Safari 打开本页</li>
              <li>点底部「分享」→「添加到主屏幕」</li>
              <li>桌面出现小虎鲸图标，点开即全屏</li>
            </ol>
            <div className="lp-copy">
              <input readOnly value={pageUrl} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={copy}>
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </>
        ) : android ? (
          <>
            <div className="lp-dialog-title">装到安卓手机</div>
            <div className="lp-dialog-sub">下载安装包，约 2 MB</div>
            <a className="lp-download" href={url} download>
              下载 小虎鲸 APK
            </a>
          </>
        ) : (
          <>
            <div className="lp-dialog-title">用手机装 App</div>
            <div className="lp-dialog-sub">手机扫码，或用链接发到手机</div>
            <div className="lp-qr" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="lp-copy">
              <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={copy}>
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </>
        )}
        <button type="button" className="lp-dialog-close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}

export { AppDialog, isMobile }
