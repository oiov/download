// 公开页面只读取最小登录状态；私有数据由服务端 Dashboard 逐次鉴权。
(() => {
  const dialog = document.querySelector('.login-dialog')
  if (!dialog) return
  const triggers = [...document.querySelectorAll('[data-login-trigger]')]
  const form = dialog.querySelector('form')
  const submit = form.querySelector('button[type=submit]')
  const error = dialog.querySelector('.login-error')
  const params = new URLSearchParams(location.search)
  const requestedLogin = params.get('login') === '1'
  const oauthFailed = requestedLogin && params.has('error')
  let authenticated = false
  let controller
  const showError = message => { error.textContent = message; error.hidden = false }
  async function refresh() {
    controller?.abort()
    const active = new AbortController()
    controller = active
    const timer = setTimeout(() => active.abort(), 8000)
    try {
      const response = await fetch('/api/account/session', { credentials: 'same-origin', cache: 'no-store', signal: active.signal })
      if (!response.ok) throw new Error('session-unavailable')
      const state = await response.json()
      authenticated = state.authenticated === true
      for (const trigger of triggers) {
        if (authenticated) trigger.textContent = trigger.dataset.dashboardLabel
        else trigger.textContent = trigger.dataset.loginLabel
        trigger.setAttribute('aria-haspopup', authenticated ? 'false' : 'dialog')
      }
      submit.disabled = !state.loginEnabled
      if (!state.loginEnabled) showError(dialog.dataset.unavailable)
      else if (oauthFailed) showError(dialog.dataset.error)
      else if (!form.hasAttribute('aria-busy')) error.hidden = true
      if (requestedLogin && authenticated) window.location.replace(dialog.dataset.dashboard)
      return true
    } catch { return false }
    finally { clearTimeout(timer) }
  }
  for (const trigger of triggers) {
    trigger.dataset.loginLabel = trigger.textContent
    trigger.setAttribute('aria-haspopup', 'dialog')
    trigger.addEventListener('click', async () => {
      if (authenticated) { window.location.assign(dialog.dataset.dashboard); return }
      if (!dialog.open) dialog.showModal()
      if (await refresh() && authenticated) window.location.assign(dialog.dataset.dashboard)
    })
  }
  dialog.querySelectorAll('[data-login-close]').forEach(button => button.addEventListener('click', () => dialog.close()))
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (form.hasAttribute('aria-busy')) return
    form.setAttribute('aria-busy', 'true'); submit.disabled = true; error.hidden = true
    try {
      const target = new URL(form.action)
      const response = await fetch('/api/account/login' + target.search, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('login-failed')
      const result = await response.json()
      if (new URL(result.url).origin !== 'https://accounts.google.com') throw new Error('login-failed')
      window.location.assign(result.url)
    } catch { showError(dialog.dataset.error); submit.disabled = false; form.removeAttribute('aria-busy') }
  })
  window.addEventListener('pageshow', () => { void refresh() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh() })
  if (requestedLogin) {
    dialog.showModal()
    if (params.has('error')) showError(dialog.dataset.error)
  }
  void refresh()
})()
