import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'

import qrcode from '../../vendor/qrcode-generator.js'

const makeQr = (data: string) => {
  const qr = qrcode(0, 'M')
  qr.addData(data)
  qr.make()
  return qr.createSvgTag({ cellSize: 3, margin: 2 })
}

export const DownloadPopover = ({ style }: { style?: CSSProperties }) => {
  const url = `${location.origin}/download/whalegirl.apk`
  const pageUrl = `${location.origin}/#chat`
  const svgApk = useMemo(() => makeQr(url), [url])
  const svgPage = useMemo(() => makeQr(pageUrl), [pageUrl])
  const [copied, setCopied] = useState('')

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('')
    }
  }

  return (
    <div className='dl-card' style={style}>
      <div className='dl-block'>
        <div className='dl-head'>安卓 · 下载安装包</div>
        <a className='dl-btn' href={url} download>
          下载 APK（约 2 MB）
        </a>
        <div className='dl-qr' dangerouslySetInnerHTML={{ __html: svgApk }} />
        <div className='dl-copy'>
          <span className="link-text">{url}</span>
          <button type='button' onClick={() => void copyText(url, 'apk')}>
            {copied === 'apk' ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      <div className='dl-block'>
        <div className='dl-head'>iPhone · 添加到主屏幕</div>
        <ol className='dl-steps'>
          <li>Safari 打开本页</li>
          <li>分享 → 添加到主屏幕</li>
          <li>点「添加」即完成</li>
        </ol>
        <div className='dl-qr' dangerouslySetInnerHTML={{ __html: svgPage }} />
        <div className='dl-copy'>
          <span className="link-text">{pageUrl}</span>
          <button type='button' onClick={() => void copyText(pageUrl, 'page')}>
            {copied === 'page' ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  )
}
