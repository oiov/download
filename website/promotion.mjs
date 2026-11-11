import promotionLinks from '../shared/promotion-links.json' with { type: 'json' }

const copy = {
  label: ['AI 模型推荐', 'AI model recommendations'],
  carousel: ['轮播', 'Carousel'],
  videoTitle: ['用 {model}，把灵感变成视频', 'Turn ideas into video with {model}'],
  videoBody: ['视频生成 API · Nbility AI 模型网关', 'Video generation API · Nbility AI Gateway'],
  modelsBody: ['一个入口，连接多种 AI 模型', 'One gateway. More AI possibilities.'],
  action: ['探索 API', 'Explore APIs'],
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const arrow = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg>'

export function renderPromotion(t) {
  const slides = [
    [escape(t(copy.videoTitle)).replace('{model}', '<span class="promotion-accent">MiniMax H3</span>'), t(copy.videoBody)],
    ['Claude <span aria-hidden="true">·</span> GPT <span aria-hidden="true">·</span> DeepSeek <span aria-hidden="true">·</span> GLM', t(copy.modelsBody)],
  ]
  return `<section class="promotion" data-promotion aria-label="${escape(t(copy.label))}" aria-roledescription="${escape(t(copy.carousel))}">
    <div class="promotion-inner">
      <div class="promotion-viewport" aria-live="off"><div class="promotion-track">${slides.map(([title, body], i) => `
        <a class="promotion-slide" data-promotion-slide href="${escape(promotionLinks.nbility)}" target="_blank" rel="sponsored noopener noreferrer" aria-hidden="${i !== 0}"${i ? ' inert tabindex="-1"' : ''}>
          <span class="promotion-copy"><strong class="promotion-title">${title}</strong><span class="promotion-description">${escape(body)}</span></span>
          <span class="promotion-cta">${escape(t(copy.action))}${arrow}</span>
        </a>`).join('')}
      </div></div>
    </div>
  </section>`
}
