// 同源代理：静态文件 + 把 /api、/v1、/avatars 转发到 new-api
// 用法：API_BASE=http://your-server node tools/proxy-server.mjs [port]
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.join(base, 'web/dist')
/** 安装包放在 android/ 下，不进前端构建产物 */
const androidDir = path.join(base, 'android')
const apiBase = new URL(process.env.API_BASE || 'http://127.0.0.1:3000')
const port = Number(process.argv[2] || 8092)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

const proxy = (req, res) => {
  const target = new URL(req.url, apiBase)
  const headers = { ...req.headers, host: target.host }
  const upstream = http.request(
    target,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`proxy error: ${error.message}`)
  })
  req.pipe(upstream)
}

const serve = (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])

  if (urlPath.startsWith('/download/')) {
    const name = path.basename(urlPath)
    const apk = path.join(androidDir, name)
    if (!existsSync(apk) || !statSync(apk).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': 'application/vnd.android.package-archive',
      'content-length': String(statSync(apk).size),
      'content-disposition': `attachment; filename="${name}"`,
    })
    createReadStream(apk).pipe(res)
    return
  }

  const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath)
  const resolved = existsSync(filePath) && statSync(filePath).isFile() ? filePath : path.join(root, 'index.html')
  res.writeHead(200, {
    'content-type': MIME[path.extname(resolved)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  createReadStream(resolved).pipe(res)
}

http
  .createServer((req, res) => {
    if (req.url?.startsWith('/api/') || req.url?.startsWith('/v1/') || req.url?.startsWith('/avatars/')) {
      proxy(req, res)
      return
    }
    serve(req, res)
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`whale web: http://127.0.0.1:${port}  ->  api ${apiBase.origin}`)
  })
