import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { site } from '../website/config.mjs'
import { guides } from '../website/content.mjs'
import { platforms } from '../website/platforms.mjs'
import { online } from '../website/online.mjs'
import { accountLinks, accountSection, loginDialog } from '../website/accounts.mjs'
import { landings } from '../website/landings.mjs'
import { renderCapabilities } from '../website/capabilities.mjs'
import { renderPromotion } from '../website/promotion.mjs'
import toolSlugs from '../shared/tool-routes.json' with { type: 'json' }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'website/dist')
// 内容变化才更换资源版本，避免新横幅 HTML 复用浏览器缓存的旧样式或脚本。
const assetUrl = name => '/assets/' + name + '?v=' + createHash('sha256').update(fs.readFileSync(path.join(root, 'website/assets', name))).digest('hex').slice(0, 12)
const cssUrl = assetUrl('site.css')
const promotionScriptUrl = assetUrl('promotion.js')
const accountScriptUrl = assetUrl('account.js')
const loginStyleUrl = assetUrl('login.css')
const configured = process.env.SITE_URL === undefined ? site.origin : process.env.SITE_URL
let origin = ''
if (configured) {
  const u = new URL(configured)
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password || u.hostname === 'localhost' || u.hostname.endsWith('.invalid') || u.hostname === 'example.com') throw new Error('SITE_URL 必须是正式 HTTPS 域名，不含路径、查询或凭据')
  origin = u.origin
}
const indexable = Boolean(origin) && process.env.VERCEL_ENV !== 'preview' && process.env.SITE_PREVIEW !== '1'
const esc = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const json = (v) => JSON.stringify(v).replaceAll('<', '\\u003c')
// 正式产物也可能被本地预览或自部署复用，加载 Google 脚本前再次核对来源。
const googleTag = indexable && origin === site.origin ? `<script>
if (window.location.origin === ${json(site.origin)} && new URLSearchParams(window.location.search).get('analytics_test') !== '1') {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ${json(site.googleAnalyticsId)});
  const script = document.createElement('script');
  script.async = true;
  script.src = ${json('https://www.googletagmanager.com/gtag/js?id=' + site.googleAnalyticsId)};
  document.head.appendChild(script);
}
</script>` : ''
const umamiTag = indexable && origin === site.origin ? `<script>
if (window.location.origin === ${json(site.origin)} && new URLSearchParams(window.location.search).get('analytics_test') !== '1') {
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://cloud.umami.is/script.js';
  script.setAttribute('data-website-id', 'b8ead086-206d-4f73-9b5e-82bf119f3591');
  document.head.appendChild(script);
}
</script>` : ''
const locales = JSON.parse(fs.readFileSync(path.join(root, 'shared/site-locales.json'), 'utf8'))
const dictionaries = Object.fromEntries(locales.slice(2).map(l => [l.code, JSON.parse(fs.readFileSync(path.join(root,'website/locales',l.prefix+'.json'),'utf8'))]))
const url = (lang, slug = '') => '/' + (locales[lang].prefix ? locales[lang].prefix + '/' : '') + (slug ? slug + '/' : '')
const catalog = new Set()
const choose = (a, lang) => {
 catalog.add(a[1])
 if (lang === 0) return a[1]
 if (lang === 1) return a[0]
 const value = dictionaries[locales[lang].code][a[1]]
 if (!value) throw new Error('Missing '+locales[lang].code+' translation: '+a[1])
 return value
}

const names = [['首页', 'Home'], ['下载', 'Download'], ['使用指南', 'Guides']]
const pages = []
// 可见的更新时间与 Article 结构化数据必须同源；词条只保留不含日期的模板，日期按语言格式化。
const UPDATED_ISO = '2026-10-18'
const UPDATED_LABEL = ['Keep Video 团队 · 更新于 {date}', 'Keep Video team · Updated {date}']
const updatedLabel = lang => choose(UPDATED_LABEL, lang).replace('{date}', new Intl.DateTimeFormat(locales[lang].code, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(UPDATED_ISO)))
const arrow = '<span aria-hidden="true">↗</span>'
const button = (href, label, secondary = false) => '<a class="button' + (secondary ? ' secondary' : '') + '" href="' + esc(href) + '">' + esc(label) + arrow + '</a>'
const landingSlugs = new Set(['app', ...landings.map(l => l.slug)])
const topLevel = new Set([...toolSlugs])
const card = (g, lang, n) => '<a class="guide-card" href="' + url(lang, (platforms.includes(g) || topLevel.has(g.slug) ? '' : 'guides/') + g.slug) + '"><span class="label">0' + (n + 1) + ' / ' + esc(choose(g.category, lang)) + '</span><h3>' + esc(choose(g.title, lang)) + '</h3><p>' + esc(choose(g.description, lang)) + '</p><span class="read">' + choose(['阅读指南', 'Read guide'], lang) + ' ↗</span></a>'

function languageMenu(lang, slug) {
 return '<details class="language-picker"><summary aria-label="Language">'+locales[lang].name+' <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m3 4.5 3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><nav class="language-options" aria-label="Languages">'+locales.map((l,i)=>'<a href="'+url(i,slug)+'" lang="'+l.code+'" hreflang="'+l.code+'"'+(i===lang?' aria-current="page"':'')+'>'+l.name+(i===lang?' <span aria-hidden="true">✓</span>':'')+'</a>').join('')+'</nav></details>'
}

function shell(lang, slug, title, description, body, crumbs = []) {
  const route = url(lang, slug)
  const localizedTitle = title + ' | ' + site.name
  const graph = [{ '@type': 'Organization', '@id': (origin || site.origin) + '/#organization', name: site.name, url: origin || site.origin, email: 'support@keep.video', contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'support@keep.video', availableLanguage: ['English', 'Chinese'] } }, { '@type': 'WebSite', name: site.name, ...(origin ? { '@id': origin + '/#website', url: origin + '/' } : {}), inLanguage: locales.map(l => l.code) }]
  const hasTool = toolSlugs.includes(slug)
  if (!slug || hasTool) graph.push({ '@type': hasTool ? 'WebApplication' : 'SoftwareApplication', name: site.name, operatingSystem: hasTool ? 'Any' : 'Web, Windows, macOS, Linux', applicationCategory: 'MultimediaApplication', ...(hasTool ? { browserRequirements: 'Requires JavaScript', inLanguage: locales[lang].code, featureList: ['Video download', 'Audio download', 'Subtitle download'] } : {}), license: site.repository + '/blob/main/LICENSE', description, ...(origin ? { url: origin + route } : {}) })
  if (crumbs.length && origin) graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: origin + c[1] })) })
  const isArticle = Boolean(slug) && slug !== 'download' && slug !== 'guides' && !landingSlugs.has(slug)
  if (isArticle) graph.push({ '@type': 'Article', headline: title, description, inLanguage: locales[lang].code, datePublished: UPDATED_ISO, dateModified: UPDATED_ISO, ...(origin ? { mainEntityOfPage: origin + route } : {}), author: { '@id': (origin || site.origin) + '/#organization' } })
  if (landingSlugs.has(slug)) graph.push({ '@type': 'FAQPage', mainEntity: faqSource(slug).map(([question, answer]) => ({ '@type': 'Question', name: choose(question, lang), acceptedAnswer: { '@type': 'Answer', text: choose(answer, lang) } })) })
  const canonical = origin ? '<link rel="canonical" href="' + origin + route + '">' + locales.map((_,l) => '<link rel="alternate" hreflang="' + (locales[l].code) + '" href="' + origin + url(l, slug) + '">').join('') + '<link rel="alternate" hreflang="x-default" href="' + origin + url(0, slug) + '"><meta property="og:url" content="' + origin + route + '">' : ''
  const crumbHTML = crumbs.length ? '<nav class="breadcrumbs" aria-label="' + choose(['面包屑', 'Breadcrumb'], lang) + '">' + crumbs.map((c, i) => i === crumbs.length - 1 ? '<span aria-current="page">' + esc(c[0]) + '</span>' : '<a href="' + c[1] + '">' + esc(c[0]) + '</a><span aria-hidden="true">/</span>').join('') + '</nav>' : ''
  const html = '<!doctype html><html lang="' + (locales[lang].code) + '"' + (hasTool ? ' data-runtime="web"' : '') + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(localizedTitle) + '</title><meta name="description" content="' + esc(description) + '"><meta name="robots" content="' + (indexable ? 'index,follow' : 'noindex,follow') + '"><meta name="theme-color" content="#11191c">' + canonical + '<meta property="og:type" content="' + (isArticle ? 'article' : 'website') + '"><meta property="og:locale" content="' + (locales[lang].og) + '"><meta property="og:site_name" content="' + esc(site.name) + '"><meta property="og:title" content="' + esc(localizedTitle) + '"><meta property="og:description" content="' + esc(description) + '"><meta property="og:image" content="' + origin + '/assets/social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="' + cssUrl + '"><link rel="stylesheet" href="' + loginStyleUrl + '"><script src="' + accountScriptUrl + '" defer></script><script src="' + promotionScriptUrl + '" defer></script><script type="application/ld+json">' + json({ '@context': 'https://schema.org', '@graph': graph }) + '</script>' + googleTag + umamiTag + '</head><body class="' + (hasTool ? 'interior webpage' : slug ? 'interior' : 'homepage') + '"><a class="skip" href="#main">' + choose(['跳到内容', 'Skip to content'], lang) + '</a>' + renderPromotion(a => choose(a, lang)) + '<header class="header"><a class="brand" href="' + url(lang) + '"><img class="brand-icon" src="/assets/brand/frame-play.svg" width="34" height="34" alt="">' + esc(site.name) + '</a><nav aria-label="' + choose(['主导航', 'Main navigation'], lang) + '"><a href="' + url(lang) + '#features">' + choose(['功能', 'Features'], lang) + '</a><a href="' + url(lang, 'guides') + '">' + choose(names[2], lang) + '</a><a href="' + url(lang, 'download') + '">' + choose(['桌面版', 'Desktop app'], lang) + '</a></nav><div class="header-actions">' + languageMenu(lang,slug) + accountLinks(lang) + '<a class="nav-download" href="' + url(lang, 'app') + '"' + (slug === 'app' ? ' aria-current="page"' : '') + '>' + choose(online.use, lang) + '</a></div></header><main id="main">' + crumbHTML + body + '</main><footer><div class="footer-top"><div><a class="brand" href="' + url(lang) + '"><img class="brand-icon" src="/assets/brand/frame-play.svg" width="34" height="34" alt="">' + esc(site.name) + '</a><p>' + choose(['好内容，值得留在身边。', 'Good things are worth keeping.'], lang) + '</p></div><div><span class="label">' + choose(['探索', 'EXPLORE'], lang) + '</span><a href="' + url(lang, 'app') + '">' + choose(online.use, lang) + '</a><a href="' + url(lang, 'download') + '">' + choose(['下载中心', 'Downloads'], lang) + '</a><a href="' + url(lang, 'guides') + '">' + choose(['使用指南', 'Guides'], lang) + '</a><a href="https://attachready.com">AttachReady ↗</a><a href="https://vmail.dev">Vmail ↗</a><a href="https://nbility.ai">Nbility ↗</a></div><div><span class="label">' + choose(['帮助与联系', 'HELP & CONTACT'], lang) + '</span><a href="mailto:support@keep.video">support@keep.video</a><a href="/license.txt">MIT License</a></div></div><div class="footer-bottom"><a href="mailto:support@keep.video">support@keep.video</a><a href="/sitemap.xml">Sitemap</a><span>© 2026 ' + esc(site.name) + '' + '</span><span>' + choose(['仅保存你拥有或已获授权的内容。', 'Save content you own or have permission to download.'], lang) + '</span></div></footer>' + (hasTool ? '<script type="module" src="/app/' + (slug === 'app' ? 'entry' : 'tool') + '.js"></script>' : '') + loginDialog(lang) + '</body></html>'
  const target = path.join(out, route, 'index.html')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, html)
  pages.push({ route, slug, lang, title: localizedTitle })
}

function home(lang) {
  const t = a => choose(a, lang)
  return '<section class="hero"><img class="hero-art" src="/assets/hero-video-download.webp" width="1672" height="940" alt="" fetchpriority="high"><div class="hero-shade"></div><div class="hero-content"><p class="eyebrow"><span></span>' + t(online.eyebrow) + '</p><h1>' + t(['把精彩，<br>留在<span>这一刻。</span>', 'Some moments.<br><span>Yours to keep.</span>']) + '</h1><p class="hero-description">' + t(online.hero) + '</p><div class="actions">' + button(url(lang, 'app'), t(online.use)) + button(url(lang, 'download'), t(online.desktop), true) + '</div><p class="hero-platforms">' + t(online.availability) + '</p><p class="hero-desktop">' + t(online.platforms) + '</p></div><div class="hero-bottom"><a href="#features">' + t(['往下探索', 'SCROLL TO EXPLORE']) + ' ↓</a><span>' + t(['瞬间灵感 / AI 视觉作品', 'MOMENTS TO KEEP / AI ARTWORK']) + '</span><span>01 — 03</span></div></section><div class="platform-strip"><span>' + t(['连接你喜欢的平台', 'FOR THE PLATFORMS YOU LOVE']) + '</span><a href="' + url(lang, 'app') + '">X / Twitter</a>' + platforms.map(p => '<a href="' + url(lang,p.slug) + '">' + esc(p.name) + '</a>').join('') + '<a href="' + url(lang, 'guides/troubleshooting') + '">' + t(['支持情况说明 ↗', 'About compatibility ↗']) + '</a></div><section class="section" id="features"><div class="section-heading"><div><p class="label">01 / KEEP WHAT MOVES YOU</p><h2>' + t(['不止收藏。<br><span>真正拥有一份本地副本。</span>', 'Beyond a bookmark.<br><span>A local copy to keep.</span>']) + '</h2></div><p>' + t(['整理自己的作品、保存获授权的素材，<br>或为下一次离线学习做好准备。', 'Archive your own work, save licensed material,<br>or get ready for your next offline study session.']) + '</p></div><div class="feature-grid"><a class="feature-card video" href="' + url(lang, 'guides/getting-started') + '"><div class="feature-art"><div class="mini-landscape"></div><span class="format">MP4 / VIDEO</span><span class="play" aria-hidden="true">▷</span></div><div class="feature-copy"><span>01</span><h3>' + t(['让画面，随时重现。', 'Keep the whole picture.']) + '</h3><p>' + t(['选择来源可用的画质，把视频保存到本地。', 'Choose an available quality and save the video locally.']) + '</p>' + arrow + '</div></a><a class="feature-card audio" href="' + url(lang, 'guides/audio') + '"><div class="feature-art"><span class="format">MP3 / AUDIO</span><div class="wave" aria-hidden="true">' + Array.from({ length: 29 }, (_, i) => '<i style="--h:' + (18 + ((i * 37 + 19) % 80)) + '%"></i>').join('') + '</div></div><div class="feature-copy"><span>02</span><h3>' + t(['只留声音，也很好。', 'Just the sound you need.']) + '</h3><p>' + t(['提取音频，让学习与聆听不受屏幕限制。', 'Save audio for listening and learning away from the screen.']) + '</p>' + arrow + '</div></a><a class="feature-card subtitles" href="' + url(lang, 'guides/subtitles') + '"><div class="feature-art"><span class="format">SRT / SUBTITLES</span><div class="subtitle-art"><small>00:01:24,000 → 00:01:28,000</small><b>' + t(['世界很大，<br>值得慢慢听懂。', 'A world of stories.<br>One line at a time.']) + '</b><span>CC &nbsp; ━━━━━━</span></div></div><div class="feature-copy"><span>03</span><h3>' + t(['每一句，都值得回味。', 'Every word, worth keeping.']) + '</h3><p>' + t(['单独保存已有字幕，方便阅读和整理。', 'Download available subtitles for reading and reference.']) + '</p>' + arrow + '</div></a></div><p class="fineprint">' + t(['画质、格式和平台可用性取决于具体来源；部分内容需要登录。', 'Quality, formats and site support depend on the source. Some content requires sign-in.']) + '</p></section>' + renderCapabilities(t, url(lang, 'download')) + '<section class="app-section"><div class="app-copy"><p class="label">02 / LESS FRICTION. MORE FLOW.</p><h2>' + t(online.browserTitle) + '</h2><p>' + t(online.browserBody) + '</p><ul class="feature-list"><li>' + t(['清晰度、音轨与格式选择', 'Quality, audio track and format selection']) + '</li><li>' + t(online.step3) + '</li><li>' + t(online.browserFeature) + '</li></ul><a class="text-link" href="' + url(lang, 'app') + '">' + t(online.use) + ' ↗</a></div><figure class="app-frame"><div class="window-bar"><span>● ● ●</span><b>ONLINE / PREVIEW</b><span>↙</span></div><img src="/assets/online-preview.jpg" width="1124" height="558" loading="lazy" alt="' + t(['Keep Video 在线工具，展示 X 视频示例输入与下载队列', 'Keep Video online tool with an X video example and download queue']) + '"><figcaption>' + t(['Keep Video 在线工具', 'Keep Video online tool']) + '</figcaption></figure></section><section class="section"><div class="section-heading"><div><p class="label">03 / A GOOD PLACE TO START</p><h2>' + t(['第一次用，<span>也能从容。</span>', 'A little guidance.<br><span>A smoother start.</span>']) + '</h2></div><a class="text-link" href="' + url(lang, 'guides') + '">' + t(['全部使用指南', 'All guides']) + ' ↗</a></div><div class="guide-grid">' + guides.slice(0, 3).map((g, i) => card(g, lang, i)).join('') + '</div></section><section class="faq section"><div><p class="label">GOOD QUESTIONS</p><h2>' + t(['你可能<br><span>还想知道。</span>', 'A few things<br><span>worth knowing.</span>']) + '</h2></div><div>' + onlineFAQs.map(q => '<details><summary>' + t(q[0]) + '</summary><p>' + t(q[1]) + '</p></details>').join('') + '<a class="text-link" href="' + url(lang, 'guides/troubleshooting') + '">' + t(['打开故障排查指南', 'Open troubleshooting guide']) + ' ↗</a></div></section><section class="closing"><p class="label">KEEP YOUR NEXT FAVORITE.</p><h2>' + t(['下一次心动，<br>记得<span>留下来。</span>', 'Your next favorite.<br><span>Keep it close.</span>']) + '</h2>' + button(url(lang, 'app'), t(online.use)) + '<p>' + t(online.availability) + '</p><a class="closing-desktop" href="' + url(lang, 'download') + '">' + t(online.platforms) + '</a></section>'
}

const onlineFAQs = [[online.account, online.accountBody], [online.supported, online.supportedBody], [online.privacy, online.privacyBody]]
// /app/ 额外的两条长尾问答只在工具页出现，首页保持三条。
const appFAQs = [...onlineFAQs, [online.quality, online.qualityBody], [online.private, online.privateBody]]

// 带工具的页面共用前五条问答，落地页再接自己的长尾问题。
const landingBySlug = Object.fromEntries(landings.map(l => [l.slug, l]))
function faqSource(slug) {
 const landing = landingBySlug[slug]
 return landing ? [...appFAQs, ...(landing.faqs || [])] : appFAQs
}

// 格式表与平台表都是静态 HTML：爬虫能读到，无 JavaScript 也能看。
function formatTable(lang) {
 const t = a => choose(a, lang)
 const rows = [['MP4', online.fmtVideo], ['MP3', online.fmtAudio], ['SRT', online.fmtSubtitle]]
 return '<section class="web-table-section"><h2>' + t(online.formatsTitle) + '</h2><div class="web-table-scroll"><table class="web-table"><thead><tr><th scope="col">' + t(online.colFormat) + '</th><th scope="col">' + t(online.colResult) + '</th></tr></thead><tbody>' + rows.map(([format, text]) => '<tr><th scope="row"><code>' + format + '</code></th><td>' + t(text) + '</td></tr>').join('') + '</tbody></table></div><p class="web-note">' + t(online.formatsNote) + '</p></section>'
}

function platformTable(lang) {
 const t = a => choose(a, lang)
 return '<section class="web-table-section"><h2>' + t(online.platformGuides) + '</h2><p>' + t(online.platformGuidesBody) + '</p><ul class="web-platforms">' + platforms.map(p => '<li><a href="' + url(lang, p.slug) + '">' + esc(p.name) + ' ↗</a></li>').join('') + '</ul></section>'
}

function onlineApp(lang) {
 const t = a => choose(a, lang)
 return '<section class="web-intro"><h1>' + t(online.title) + '</h1><p>' + t(online.appLead) + '</p></section><div id="app"><p class="app-loading" role="status">' + t(online.loading) + '</p><noscript><p>' + t(online.noscript) + '</p><a href="' + url(lang, 'download') + '">' + t(online.desktop) + '</a></noscript></div><section class="web-info"><h2>' + t(online.steps) + '</h2><ol class="online-steps">' + [[online.step1,online.step1Body],[online.step2,online.step2Body],[online.step3,online.step3Body]].map(([title,body],i) => '<li><span class="step-number">0' + (i+1) + '</span><h3>' + t(title) + '</h3><p>' + t(body) + '</p></li>').join('') + '</ol>' + formatTable(lang) + platformTable(lang) + '<div class="web-faq"><h2>' + t(online.faq) + '</h2><div>' + appFAQs.map(([question,answer]) => '<details><summary>' + t(question) + '</summary><p>' + t(answer) + '</p></details>').join('') + '</div></div><p class="web-note">' + t(online.rights) + ' <a href="' + url(lang, 'guides') + '">' + t(names[2]) + ' ↗</a></p><a class="text-link" href="' + url(lang, 'download') + '">' + t(online.desktopNote) + ' ↗</a></section>'
}

// 在线操作与桌面专属步骤分别标明，避免把本机依赖或 Cookie 配置误用于网页。
// 落地页正文：工具在首屏，后面按"怎么做 → 能拿到什么 → 该词独有的细节 → 问答"排列。
// 平台表不放进来：落地页要接住的是自己的搜索意图，平台细节留给各自的平台页。
function landingPage(landing, lang) {
 const t = a => choose(a, lang)
 const steps = '<ol class="online-steps">' + [[online.step1,online.step1Body],[online.step2,online.step2Body],[online.step3,online.step3Body]].map(([title,body],i) => '<li><span class="step-number">0' + (i+1) + '</span><h3>' + t(title) + '</h3><p>' + t(body) + '</p></li>').join('') + '</ol>'
 const sections = landing.sections.map(([heading, body]) => '<section class="web-detail"><h2>' + t(heading) + '</h2><p>' + t(body) + '</p></section>').join('')
 const faqs = faqSource(landing.slug).map(([question, answer]) => '<details><summary>' + t(question) + '</summary><p>' + t(answer) + '</p></details>').join('')
 const siblings = '<section class="web-related"><h2>' + t(['继续按来源保存', 'More on saving video']) + '</h2><div class="web-platforms">' + landing.siblings.map(slug => {
  const next = landingBySlug[slug]
  return '<a href="' + url(lang, slug) + '">' + esc(t(next.h1)) + ' ↗</a>'
 }).join('') + '</div></section>'
 const guides = '<section class="web-related"><h2>' + t(['相关指南', 'Related guides']) + '</h2><div class="web-platforms">' + landing.related.map(slug => {
  const next = platforms.find(p => p.slug === slug)
  return '<a href="' + url(lang, slug) + '">' + esc(next.name) + ' ↗</a>'
 }).join('') + '</div></section>'
 return '<section class="web-intro"><h1>' + t(landing.h1) + '</h1><p>' + t(landing.lead) + '</p></section>' +
  '<div id="app"><p class="app-loading" role="status">' + t(online.loading) + '</p><noscript><p>' + t(online.noscript) + '</p><a href="' + url(lang, 'download') + '">' + t(online.desktop) + '</a></noscript></div>' +
  '<section class="web-info"><h2>' + t(online.steps) + '</h2>' + steps + formatTable(lang) + sections + '<div class="web-faq"><h2>' + t(online.faq) + '</h2><div>' + faqs + '</div></div>' + siblings + guides +
  '<p class="web-note">' + t(online.rights) + '</p><a class="text-link" href="' + url(lang, 'download') + '">' + t(online.desktopNote) + ' ↗</a></section>'
}

const desktopHeading = ["桌面版详细操作","Desktop app instructions"]
const desktopNote = ["以下步骤仅适用于桌面版。在线版的运行依赖由服务器管理，不读取你本机浏览器的 Cookie。","The following steps apply only to the desktop app. Online runtime tools are managed by the server; it does not read cookies from your local browser."]
function articleOnline(lang) {
 const t = a => choose(a, lang)
 return '<section id="online-workflow" class="online-workflow"><h2>' + t(online.title) + '</h2><p>' + t(online.browserBody) + '</p>' + [[online.step1,online.step1Body],[online.step2,online.step2Body],[online.step3,online.step3Body]].map(([title,body]) => '<h3>' + t(title) + '</h3><p>' + t(body) + '</p>').join('') + '<p>' + t(online.accountBody) + '</p><p>' + t(online.privacyBody) + '</p>' + button(url(lang, 'app'), t(online.use)) + '</section>'
}

function downloads(lang) {
 const t = a => choose(a, lang)
 return '<section class="page-heading"><p class="label">YOUR FILES. YOUR DESKTOP.</p><h1>' + t(['为你的电脑，<br><span>选一个入口。</span>', 'Your computer.<br><span>Your starting point.</span>']) + '</h1><p>' + t(['下载桌面应用，在本地保存视频、音频与字幕。', 'Get the desktop app to save video, audio and subtitles locally.']) + '</p></section><section class="section download-section"><aside class="online-banner"><div><h2>' + t(online.browserTitle) + '</h2><p>' + t(online.availability) + '</p></div>' + button(url(lang, 'app'), t(online.use)) + '</aside><div class="release-note"><span class="status-dot"></span><div><strong>' + t(site.releaseAvailable ? ['本项目安装包已发布', 'Project installers are available'] : ['本项目首个安装包正在准备中', 'The first project release is being prepared']) + '</strong><p>' + t(site.releaseAvailable ? ['请在发布页面选择与你电脑架构匹配的文件。', 'Choose an installer matching your computer on the releases page.'] : ['安装包将在 Keep Video 的 GitHub Releases 提供，可在这里查看发布进度。', 'Keep Video installers will be available on our GitHub Releases page. Follow release progress here.']) + '</p></div></div><div class="download-grid">' + [
 ['macOS', '01', ['Apple 芯片 / Intel', 'Apple silicon / Intel'], ['在“关于本机”确认芯片类型，选择 ARM64 或 x64 的 DMG 安装包。', 'Check About This Mac, then choose the ARM64 or x64 DMG for your processor.']],
 ['Windows', '02', ['Windows x64', 'Windows x64'], ['选择 x64 EXE 安装包。首次启动后按提示配置运行依赖。', 'Choose the x64 EXE installer. Follow runtime setup prompts on first launch.']],
 ['Linux', '03', ['AppImage / DEB', 'AppImage / DEB'], ['按系统架构和发行版选择文件，具体格式以对应 Release 提供的产物为准。', 'Match the architecture and distribution. Available package formats depend on the release.']],
 ].map(p => '<article class="download-card"><span class="label">' + p[1] + ' / DESKTOP</span><h2>' + p[0] + '</h2><b>' + t(p[2]) + '</b><p>' + t(p[3]) + '</p>' + button(site.repository + '/releases', t(site.releaseAvailable ? ['查看安装包', 'View installers'] : ['查看发布进度', 'View release progress'])) + '</article>').join('') + '</div><div class="download-help"><h2>' + t(['安装完成，下一步呢？', 'Installed. What next?']) + '</h2><p>' + t(['准备 yt-dlp / FFmpeg，然后粘贴你的第一个视频链接。YouTube 可能还需要自行安装 Node.js 或 Deno。', 'Prepare yt-dlp and FFmpeg, then paste your first video URL. YouTube may also need a separately installed Node.js or Deno runtime.']) + '</p>' + button(url(lang, 'guides/getting-started'), t(['阅读首次使用指南', 'Read the setup guide']), true) + ' ' + button(site.repository, t(['查看本项目源码', 'View project source']), true) + '</div></section>'
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'license.txt'))
fs.cpSync(path.join(root, 'website/assets'), path.join(out, 'assets'), { recursive: true })
for (const lang of locales.keys()) {
 const t = a => choose(a, lang)
 const homeCrumb = [t(names[0]), url(lang)]
 shell(lang, '', t(online.homeTitle), t(online.homeMeta), home(lang).replace('<section class="closing">', accountSection(lang) + '<section class="closing">'))
 shell(lang, 'app', t(online.appTitle), t(online.meta), onlineApp(lang) + accountSection(lang))
 shell(lang, 'download', t(['下载中心：macOS、Windows 和 Linux', 'Downloads for macOS, Windows and Linux']), t(['选择适合电脑的 Keep Video 安装包，了解芯片架构、版本来源与首次运行依赖配置。', 'Choose a Keep Video installer for your computer and understand architecture, release sources and first-launch runtime setup.']), downloads(lang), [homeCrumb, [t(names[1]), url(lang, 'download')]])
 shell(lang, 'guides', t(['使用指南：在线下载、桌面版、音频与字幕', 'Guides: online downloads, desktop, audio and subtitles']), t(['了解 Keep Video 在线下载与桌面版的使用步骤，保存视频、音频和字幕，并按使用方式排查问题。', 'Learn to use Keep Video online or on desktop to save video, audio and subtitles, with troubleshooting steps for each mode.']), '<section class="page-heading"><p class="label">THE FIELD GUIDE</p><h1>' + t(['少一点摸索。<br><span>多一点顺手。</span>', 'Less guesswork.<br><span>More getting there.</span>']) + '</h1><p>' + t(['从第一个链接开始，找到你需要的那一步。', 'From your first link onward, find the step you need.']) + '</p></section><section class="section guide-index"><div class="guide-grid">' + [...guides, ...platforms].map((g,i) => card(g,lang,i)).join('') + '</div></section>', [homeCrumb, [t(names[2]), url(lang, 'guides')]])
 for (const g of [...guides, ...platforms]) {
  const slug = (platforms.includes(g) || topLevel.has(g.slug) ? '' : 'guides/') + g.slug
  // 带工具的平台页把工具放在标题之后、正文之前：搜索进来第一屏就能用，说明留到工具下方。
  const toolSlot = toolSlugs.includes(g.slug) ? '<div id="app" class="tool-slot"><p class="app-loading" role="status">' + t(online.loading) + '</p><noscript><p>' + t(online.noscript) + '</p><a href="' + url(lang, 'download') + '">' + t(online.desktop) + '</a></noscript></div>' : ''
  const content = '<article class="article"><header><p class="label">' + t(g.category) + '</p><h1>' + esc(t(g.title)) + '</h1><p class="intro">' + esc(t(g.intro)) + '</p><p class="label">' + esc(updatedLabel(lang)) + '</p></header>' + toolSlot + '<nav class="toc" aria-label="' + t(['本文目录', 'On this page']) + '"><strong>' + t(['本文内容', 'On this page']) + '</strong><a href="#online-workflow">' + t(online.title) + '</a><a href="#desktop-workflow">' + t(desktopHeading) + '</a>' + g.sections.map((s,i) => '<a href="#step-' + i + '">' + esc(t(s[0])) + '</a>').join('') + '</nav>' + articleOnline(lang) + '<section id="desktop-workflow" class="desktop-workflow"><h2>' + t(desktopHeading) + '</h2><p>' + t(desktopNote) + '</p>' + g.sections.map((s,i) => '<section id="step-' + i + '"><h3>' + esc(t(s[0])) + '</h3><p>' + esc(t(s[1])) + '</p></section>').join('') + '</section><aside class="article-cta"><h2>' + t(['准备开始了吗？', 'Ready to get started?']) + '</h2><p>' + t(online.tryNow) + '</p>' + button(url(lang, 'app'), t(online.use)) + '</aside><section class="related"><h2>' + t(['接着看看', 'Read next']) + '</h2>' + g.related.map(slug => { const next = guides.find(x => x.slug === slug); return '<a href="' + url(lang, 'guides/' + slug) + '">' + esc(t(next.title)) + ' ↗</a>' }).join('') + '</section><section><h2>' + t(['支持依据与联系', 'Sources and support']) + '</h2><p>' + t(['平台支持基于 yt-dlp 提取器；平台变化可能影响可用性。', 'Platform support relies on yt-dlp extractors and can change as platforms evolve.']) + '</p><p><a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md">yt-dlp supported sites</a> · <a href="https://github.com/yt-dlp/yt-dlp#installation">yt-dlp installation</a> · <a href="mailto:support@keep.video">support@keep.video</a></p></section></article>'
  shell(lang, slug, t(g.title), t(g.description), content, [homeCrumb, [t(names[2]), url(lang, 'guides')], [t(g.title), url(lang, slug)]])
 } for (const landing of landings) {
  shell(lang, landing.slug, t(landing.title), t(landing.description), landingPage(landing, lang) + accountSection(lang), [homeCrumb, [t(landing.h1), url(lang, landing.slug)]])
 }
}
const sitemap = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' + (indexable ? pages.map(p => '<url><loc>' + esc(origin + p.route) + '</loc>' + locales.map((_,l) => '<xhtml:link rel="alternate" hreflang="' + (locales[l].code) + '" href="' + esc(origin + url(l,p.slug)) + '"/>').join('') + '<xhtml:link rel="alternate" hreflang="x-default" href="' + esc(origin + url(0,p.slug)) + '"/></url>').join('') : '') + '</urlset>'
fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap)
// 允许抓取以读取 noindex；预览模式不提交 URL，也不输出虚构域名。
fs.writeFileSync(path.join(out, 'robots.txt'), ['User-agent: *', 'Allow: /', ...(indexable ? ['', 'Sitemap: ' + origin + '/sitemap.xml'] : []), ''].join(String.fromCharCode(10)))
fs.writeFileSync(path.join(out, '404.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Page not found | Keep Video</title><link rel="stylesheet" href="' + cssUrl + '"></head><body><main class="page-heading"><p class="label">404 / NOT FOUND</p><h1>This page<br>is not here.</h1><p>Page not found.</p><a class="button" href="/">Back to home ↗</a></main></body></html>')
console.log('官网已生成 ' + pages.length + ' 页；收录模式：' + (indexable ? origin : '预览 noindex'))

const knowledge = '# Keep Video\n\n> Online video, audio and subtitle downloader, with desktop apps for Windows, macOS and Linux. Official site: https://keep.video. Support: support@keep.video.\n\nThe online tool at https://keep.video/app/ parses and downloads media on the server and delivers the result to your device. Desktop installers remain available at /download/. Supports X / Twitter, YouTube, Bilibili, TikTok, Instagram and Vimeo through yt-dlp. Availability depends on each source, permissions and platform changes. No guarantee of every URL, original quality, watermark removal or bypassing access controls. Online use needs no local installation: the server manages yt-dlp, FFmpeg and JavaScript runtimes. Only desktop users configure local runtime tools and their own cookies. The online tool accepts public links without sign-in and cannot read local browser cookies.\n\n## Official resources\n\n' + pages.map(p => '- [' + p.route + '](' + (origin || site.origin) + p.route + ')').join('\n') + '\n\n- [Source and releases](https://github.com/oiov/download)\n- [Supported extractors](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)\n';
fs.writeFileSync(path.join(out,'llms.txt'), knowledge)

if (process.env.EXPORT_CATALOG) fs.writeFileSync('work/translation-source.json', JSON.stringify([...catalog].sort(),null,2))

fs.writeFileSync(path.join(out,'_redirects'), '/en / 301\n/en/ / 301\n/en/* /:splat 301\n/zh-cn /zh/ 301\n/zh-cn/ /zh/ 301\n/zh-cn/* /zh/:splat 301\n')
