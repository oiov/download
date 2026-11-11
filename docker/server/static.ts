import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

export function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL, website: string, app: string) {
  const redirect = (location: string) => { res.writeHead(308, { Location: location + url.search }); res.end() }
  if (url.pathname === '/zh-cn' || url.pathname.startsWith('/zh-cn/')) return redirect('/zh' + url.pathname.slice(6) + (url.pathname === '/zh-cn' ? '/' : ''))
  if (url.pathname === '/en' || url.pathname.startsWith('/en/')) return redirect(url.pathname.slice(3) || '/')
  // HTML 由统一门户生成；仅脚本与构建资源使用 WebUI 输出目录。
  const isAppAsset = url.pathname === '/app/entry.js' || url.pathname === '/app/tool.js' || url.pathname.startsWith('/app/assets/')
  const root = path.resolve(isAppAsset ? app : website)
  let pathname: string
  try { pathname = decodeURIComponent(isAppAsset ? url.pathname.slice(5) : url.pathname) } catch { res.writeHead(400).end(); return }
  // 门户路径去掉开头斜杠再解析，避免绝对路径越界。
  let file = path.resolve(root, pathname.replace(/^\/+/, ''))
  if ((!file.startsWith(root + path.sep) && file !== root) || pathname.includes('\\') || pathname.includes('\0')) { res.writeHead(404).end(); return }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) return redirect(url.pathname + '/')
    file = path.join(file, 'index.html')
  }
  let status = 200
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    status = 404
    file = path.join(website, '404.html')
  }
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return }
  const ext = path.extname(file)
  res.writeHead(status, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || isAppAsset ? 'no-cache' : 'public, max-age=3600' })
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}
