// 官网抓取与发布模式回归；复用已有三个平台 CI 的 lint:website 入口。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
const landingRoutes = ['app', 'save-video', 'save-video-from-twitter', 'save-video-from-facebook']
const toolRoutes = JSON.parse(readFileSync(new URL('../shared/tool-routes.json', import.meta.url), 'utf8'))
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out=path.join(root,'website/dist')
const build=(env={})=>execFileSync(process.execPath,['scripts/build-website.mjs'],{cwd:root,env:{...process.env,SITE_URL:'',SITE_PREVIEW:'',VERCEL_ENV:'',...env},stdio:'pipe'})
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)])
function checkGoogleTag(html, enabled) {
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter(match=>match[1].includes('googletagmanager.com/gtag/js'))
 assert.equal(scripts.length,enabled?1:0,'GA4 只能在正式域名的非预览页面中注入一次')
 if(!enabled) {
  assert(!html.includes('G-88W870PGZH')&&!html.includes('googletagmanager.com'),'非生产页面不得残留 Google 统计代码')
  return
 }
 assert(scripts[0].index>html.indexOf('<head>')&&scripts[0].index<html.indexOf('</head>'),'GA4 必须位于公共 head 中')
 const execute=(origin,dataLayer,search='')=>{
  const loaded=[]
  const window={location:{origin,search},...(dataLayer?{dataLayer}:{})}
  const document={createElement:tag=>({tagName:tag}),head:{appendChild:script=>loaded.push(script)}}
  vm.runInNewContext(scripts[0][1],{window,document,URLSearchParams},{timeout:1000})
  return {window,loaded}
 }
 for(const existing of [undefined,[]]) {
  const {window,loaded}=execute('https://keep.video',existing)
  if(existing) assert.equal(window.dataLayer,existing,'必须保留已有 dataLayer')
  assert.equal(typeof window.gtag,'function')
  const events=Array.from(window.dataLayer,entry=>Array.from(entry))
  assert.equal(events.length,2,'只能初始化一次并配置一次，避免重复浏览量')
  assert.equal(events[0][0],'js')
  assert(Number.isFinite(events[0][1].getTime()),'初始化时间必须是有效 Date')
  assert.deepEqual(events[1],['config','G-88W870PGZH'])
  assert.deepEqual(loaded,[{tagName:'script',async:true,src:'https://www.googletagmanager.com/gtag/js?id=G-88W870PGZH'}])
 }
 assert.equal(execute('https://keep.video',undefined,'?analytics_test=1').loaded.length,0,'测试访问不发送 GA4')
 for(const origin of ['http://localhost:4179','http://127.0.0.1:4179','https://seo-check.test','https://keep.video.example.org','http://keep.video','null']) {
  const {window,loaded}=execute(origin)
  assert.equal(loaded.length,0,'非正式来源不得加载 Google 脚本：'+origin)
  assert.equal(window.dataLayer,undefined,'非正式来源不得初始化 GA4：'+origin)
 }
}
function checkUmamiTag(html,enabled) {
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter(match=>match[1].includes('cloud.umami.is'))
 assert.equal(scripts.length,enabled?1:0)
 if(!enabled)return
 for(const [origin,search,expected] of [['https://keep.video','',1],['https://keep.video','?analytics_test=1',0],['http://localhost:6080','',0]]) {
  const loaded=[]
  const window={location:{origin,search}}
  const document={createElement:()=>({setAttribute(name,value){this[name]=value}}),head:{appendChild:script=>loaded.push(script)}}
  vm.runInNewContext(scripts[0][1],{window,document,URLSearchParams},{timeout:1000})
  assert.equal(loaded.length,expected,'Umami 只加载一次，且排除预览、测试和本地')
  if(expected) { assert.equal(loaded[0].src,'https://cloud.umami.is/script.js'); assert.equal(loaded[0]['data-website-id'],'b8ead086-206d-4f73-9b5e-82bf119f3591') }
 }
}
function checkGooglePages(enabled) {
 const pages=files(out).filter(file=>file.endsWith('index.html'))
 assert.equal(pages.length,144)
 for(const file of pages) { const html=fs.readFileSync(file,'utf8'); checkGoogleTag(html,enabled); checkUmamiTag(html,enabled) }
}
// 每种语言独立锁定双端定位，不能只验证词条存在或从生产文案生成预期值。
const modeWords={en:[/online/i,/desktop/i],zh:[/在线/,/桌面/],es:[/online/i,/escritorio/i],'pt-br':[/online/i,/desktop/i],de:[/online/i,/desktop/i],fr:[/en ligne/i,/ordinateur|bureau/i],ja:[/オンライン/,/デスクトップ/],ko:[/온라인/,/데스크톱/],ru:[/онлайн/i,/компьютер/i]}
// 功能区必须在首屏之后，且四项本机能力只能出现在明确标注的桌面章节。
function checkCapabilities(html, prefix, language) {
 const start=html.indexOf('<section class="section capability-section"')
 assert(start>html.indexOf('class="hero"'),'首页缺少功能展示区，或覆盖了首屏')
 const end=html.indexOf('</section>',start)
 const section=html.slice(start,end)
 assert.equal((html.match(/id="capabilities"/g)||[]).length,1,'功能展示区 ID 必须唯一')
 assert(section.includes('aria-labelledby="capabilities-title"'),'功能区缺少可访问名称')
 assert.equal((section.match(/data-capability=/g)||[]).length,6,'首页必须展示六类能力')
 for(const key of ['platforms','formats','acceleration','cookies','dependencies','updates']) assert(section.includes('data-capability="'+key+'"'),'缺少功能：'+key)
 const desktop=section.indexOf('class="capability-desktop"')
 assert(desktop>0,'缺少桌面能力分区')
 for(const key of ['acceleration','cookies','dependencies','updates']) assert(section.indexOf('data-capability="'+key+'"')>desktop,'本机能力不得混入在线能力：'+key)
 const boundary=section.match(/class="capability-boundary">([^<]+)<\/p>/)?.[1]||''
 for(const word of modeWords[language]) assert(word.test(boundary),'功能说明必须区分在线与桌面版：'+language)
 assert(section.includes('href="/'+prefix+'download/"'),'桌面入口必须保持当前语言')
 for(const name of ['YouTube','Bilibili','X / Twitter','TikTok','Instagram','Vimeo',language==='zh'?'抖音':'Douyin',language==='zh'?'快手':'Kuaishou']) assert(section.includes(name),'缺少平台展示：'+name)
 for(const name of ['MP3','SRT','aria2c','cookies.txt','yt-dlp','FFmpeg','Node / Deno','GitHub Releases']) assert(section.includes(name),'功能说明缺少必要限制或格式：'+name)
 assert(!/<(?:button|input|script)\b/.test(section),'功能展示不得伪装成可操作的下载或登录界面')
 assert(!/\b\d+(?:\.\d+)?\s*(?:MB\/s|GB\/s)/.test(section),'功能展示不得编造下载速度')
}
try {
 build({SITE_URL:'https://seo-check.test'})
 const pages=files(out).filter(f=>f.endsWith('index.html'))
 assert.equal(pages.length,144)
 for(const platform of ['youtube','bilibili','tiktok','instagram','vimeo']) for(const prefix of ['', 'zh/', 'es/', 'pt-br/', 'de/', 'fr/', 'ja/', 'ko/', 'ru/']) {
  const html=fs.readFileSync(path.join(out,prefix+platform+'-video-downloader/index.html'),'utf8')
  assert(html.includes('support@keep.video'))
  assert(html.includes('yt-dlp supported sites'))
 }
 assert(fs.readFileSync(path.join(out,'llms.txt'),'utf8').includes('support@keep.video'))
 const titles=new Set(), descriptions=new Set()
 for(const file of pages){
  const html=fs.readFileSync(file,'utf8')
  const route='/'+path.relative(out,path.dirname(file)).split(path.sep).filter(Boolean).join('/')+(path.dirname(file)===out?'':'/')
  assert.equal((html.match(/<h1[ >]/g)||[]).length,1,file)
  assert(html.includes('content="index,follow"'),file)
  const canonical=html.match(/rel="canonical" href="([^"]+)"/)?.[1]
  assert.equal(canonical,'https://seo-check.test'+route)
  assert.equal((html.match(/hreflang="x-default"/g)||[]).length,1)
  const title=html.match(/<title>(.*?)<\/title>/)?.[1]
  const description=html.match(/name="description" content="([^"]+)"/)?.[1]
  const language=route.split('/')[1] in modeWords?route.split('/')[1]:'en'
  if(route==='/'||Object.keys(modeWords).some(prefix=>route==='/'+prefix+'/')) checkCapabilities(html,language==='en'?'':language+'/',language)
  const article=route.includes('-video-downloader/')||/\/guides\/[^/]+\/$/.test(route)
  if(route.includes('-video-downloader/')||route.endsWith('/guides/getting-started/')) {
   for(const word of modeWords[language]) {
    assert(word.test(title),'标题缺少在线或桌面定位：'+route)
    assert(word.test(description),'描述缺少在线或桌面定位：'+route)
    assert(word.test(html.match(/<h1>(.*?)<\/h1>/)?.[1]),'H1 缺少双端定位：'+route)
   }
   assert.equal(html.match(/property="og:title" content="([^"]+)"/)?.[1],title)
   assert.equal(html.match(/property="og:description" content="([^"]+)"/)?.[1],description)
  }
  if(article) {
   const online=html.indexOf('<section id="online-workflow"')
   const desktop=html.indexOf('<section id="desktop-workflow"')
   assert(online>=0&&desktop>online,'指南必须先解释在线操作，再限定桌面步骤：'+route)
   assert(desktop<html.indexOf('<section id="step-0"'),'本机配置必须在桌面章节内：'+route)
   const workflow=html.slice(online,desktop)
   const prefix=language==='en'?'':language+'/'
   assert(workflow.includes('href="/'+prefix+'app/"'),'正文缺少当前语言在线入口：'+route)
   for(const word of modeWords[language]) assert(word.test(workflow),'在线说明缺少模式边界：'+route)
   assert(!html.includes('This website provides information and download links;')&&!html.includes('网页提供介绍与下载入口'),'不得恢复网站仅供介绍的旧描述')
  }
  assert(title&&!titles.has(title),'重复或缺失 title'); titles.add(title)
  assert(description&&!descriptions.has(description),'重复或缺失 description');descriptions.add(description)
  const prefixes={'zh':'zh-CN','es':'es','pt-br':'pt-BR','de':'de','fr':'fr','ja':'ja','ko':'ko','ru':'ru'}
  assert(html.includes('<html lang="'+(prefixes[route.split('/')[1]]||'en')+'"'))
  assert.equal((html.match(/<link rel="alternate"/g)||[]).length,10)
  assert.equal((html.match(/class="language-options"/g)||[]).length,1)
  assert(!html.includes('downvid-coral')&&!html.includes('raw.githubusercontent.com'))
  for(const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) JSON.parse(m[1])
  assert(!html.includes('cloud.umami.is'),'自部署校验域名不加载 Umami')
  checkGoogleTag(html,false)
  // 带工具的页面（/app/ 与落地页）必须只加载一个入口脚本、带工具本体与问答结构化数据。
  const toolSlug = toolRoutes.find(slug => route.endsWith('/' + slug + '/'))
  if(toolSlug) {
   const landing = landingRoutes.includes(toolSlug)
   const entryName = toolSlug === 'app' ? 'entry' : 'tool'
   assert.equal((html.match(/<script[^>]+src=/g)||[]).length,3,'工具页只加载公共登录、推广脚本与一个工具入口')
   assert(html.includes('src="/app/' + entryName + '.js"'),'入口脚本不对：' + route)
   assert(html.includes('id="app"'),'缺少工具挂载点：' + route)
   assert(html.includes('<noscript>'),'缺少 noscript 兜底：' + route)
   assert(html.includes('"@type":"WebApplication"'),'带工具的页面需要 WebApplication：' + route)
   if(landing) {
    assert(html.includes('"@type":"FAQPage"'),'落地页需要 FAQPage：' + route)
    assert(html.includes('class="online-steps"'),'落地页需要步骤说明：' + route)
    assert(!html.includes('"@type":"Article"'),'落地页不应标为文章：' + route)
   } else {
    // 带工具的内容页仍是文章：正文与工具并存，两种类型都要有。
    assert(html.includes('"@type":"Article"'),'带工具的内容页应保留 Article：' + route)
   }
  } else assert.equal((html.match(/<script[^>]+src=/g)||[]).length,2,'门户非生产页面只加载公共登录与推广脚本')
  for(const m of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)){
   const href=m[1]
   if(!href.startsWith('/'))continue
   if(href === '/app/entry.js' || href === '/app/tool.js')continue
   const pathname=new URL(href,'https://seo-check.test').pathname
   // 动态账户入口由同域 Node 服务提供，HTTP 回归另行验证，不能加入公开站点地图。
   if(['/account','/pricing','/developers'].includes(pathname))continue
   const target=path.join(out,pathname.endsWith('/')?pathname+'index.html':pathname)
   assert(fs.existsSync(target),'损坏的内链/资源：'+href)
  }
  for(const m of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)){
   const alternate=fs.readFileSync(path.join(out,new URL(m[2]).pathname,'index.html'),'utf8')
   assert(alternate.includes('href="'+canonical+'"'),'缺失语言回链')
  }
 }
 const sitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8')
 assert.equal((sitemap.match(/<loc>/g)||[]).length,144)
 assert(fs.readFileSync(path.join(out,'robots.txt'),'utf8').includes('Sitemap: https://seo-check.test/sitemap.xml'))
 const social=fs.readFileSync(path.join(out,'assets/social.png'))
 assert.equal(social.readUInt32BE(16),1200);assert.equal(social.readUInt32BE(20),630)
 build({SITE_URL:'https://keep.video'})
 checkGooglePages(true)
 const desktop=fs.readFileSync(path.join(root,'index.html'),'utf8')
 assert(!/googletagmanager|google-analytics|G-88W870PGZH|\bgtag\b/.test(desktop),'桌面入口不得注入 GA4')
 build({SITE_URL:'https://keep.video',VERCEL_ENV:'preview'})
 checkGooglePages(false)
 assert(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('content="noindex,follow"'))
 assert(!fs.readFileSync(path.join(out,'sitemap.xml'),'utf8').includes('<loc>'))
 build({SITE_URL:'https://keep.video',SITE_PREVIEW:'1'})
 checkGooglePages(false)
 assert(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('content="noindex,follow"'))
 build()
 checkGooglePages(false)
 const preview=fs.readFileSync(path.join(out,'index.html'),'utf8')
 assert(preview.includes('content="noindex,follow"'))
 assert(!preview.includes('rel="canonical"'))
 assert(!preview.includes('hreflang="x-default"'))
 assert(!fs.readFileSync(path.join(out,'sitemap.xml'),'utf8').includes('<loc>'))
 for(const invalid of ['http://site.test','https://site.test/path','https://site.test?key=a','https://user:password@site.test','https://example.com'])assert.throws(()=>build({SITE_URL:invalid}))
 console.log('官网校验通过：144 个九语言页面、独立元数据、语言回链、JSON-LD、资源、生产/预览模式、GA4 来源隔离与域名校验。')
} finally {execFileSync(process.execPath,['scripts/build-website.mjs'],{cwd:root,stdio:'pipe'})}
