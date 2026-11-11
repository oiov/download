// 独立于下载工具运行；脚本不可用时仍保留第一屏的真实推广链接。
const promotion = document.querySelector('[data-promotion]')
if (promotion) {
  const slides = [...promotion.querySelectorAll('[data-promotion-slide]')]
  const viewport = promotion.querySelector('.promotion-viewport')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let current = 0
  let hovered = false
  let focused = false
  let timer

  function stop() {
    window.clearTimeout(timer)
  }

  function schedule() {
    stop()
    if (!reducedMotion.matches && !hovered && !focused && !document.hidden) {
      timer = window.setTimeout(() => show((current + 1) % slides.length), 7000)
    }
  }

  function show(index) {
    current = index
    slides.forEach((slide, i) => {
      const active = i === current
      slide.setAttribute('aria-hidden', String(!active))
      slide.inert = !active
      slide.tabIndex = active ? 0 : -1
    })
    schedule()
  }

  promotion.addEventListener('mouseenter', () => { hovered = true; stop() })
  promotion.addEventListener('mouseleave', () => { hovered = false; schedule() })
  promotion.addEventListener('focusin', event => {
    // 键盘阅读时暂停，鼠标移开后继续自动切换。
    focused = event.target.matches(':focus-visible')
    viewport.setAttribute('aria-live', focused ? 'polite' : 'off')
    stop()
  })
  promotion.addEventListener('focusout', event => {
    if (promotion.contains(event.relatedTarget)) return
    focused = false
    viewport.setAttribute('aria-live', 'off')
    schedule()
  })
  document.addEventListener('visibilitychange', schedule)
  reducedMotion.addEventListener('change', schedule)
  window.addEventListener('pagehide', stop)
  window.addEventListener('pageshow', schedule)
  schedule()
}
