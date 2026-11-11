import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../website/dist')
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.xml':'application/xml', '.txt':'text/plain; charset=utf-8' }
http.createServer((req,res) => {
 let pathname
 try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { res.writeHead(400).end(); return }
 if (pathname === '/zh-cn' || pathname.startsWith('/zh-cn/')) { res.writeHead(308,{Location:'/zh'+pathname.slice(6)+(pathname==='/zh-cn'?'/':'')}).end(); return }
 if (pathname === '/en' || pathname === '/en/' || pathname.startsWith('/en/')) { res.writeHead(301,{Location:pathname.replace(/^\/en\/?/,'/')}).end(); return }
 let target = path.resolve(root, '.' + pathname)
 if (!target.startsWith(root + path.sep) && target !== root) { res.writeHead(403).end(); return }
 if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
  if (!pathname.endsWith('/')) { res.writeHead(308,{Location:pathname+'/'}).end(); return }
  target=path.join(target,'index.html')
 }
 const exists=fs.existsSync(target) && fs.statSync(target).isFile()
 if (!exists) target=path.join(root,'404.html')
 res.writeHead(exists?200:404,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'})
 fs.createReadStream(target).pipe(res)
}).listen(Number(process.env.PORT || 4179), '127.0.0.1', () => console.log('官网预览：http://127.0.0.1:' + (process.env.PORT || 4179)))
