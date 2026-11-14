<template>
  <div class="flex-1 flex overflow-hidden" :class="{ 'tool-workspace': isWeb }">
    <!-- Left Panel -->
    <section class="w-[65%] flex flex-col bg-surface relative" :class="{ 'tool-input-panel': isWeb }">
      <div class="flex-1 overflow-y-auto px-8 py-6" :class="{ 'tool-input-inner': isWeb }">
        <div class="max-w-xl mx-auto w-full flex flex-col gap-6">
          <div v-if="!isWeb" class="flex flex-col gap-1">
            <h1 class="font-headline text-2xl font-bold leading-tight text-on-surface">{{ t('download.title') }}</h1>
            <p class="text-on-surface-variant text-sm">{{ isWeb ? t('web.subtitle') : t('download.subtitle') }}</p>
          </div>

          <UrlInput :retry-seconds="retrySeconds" @parse="parseVideo" />
          <p v-if="isWeb" class="text-xs text-on-surface-variant">{{ t('web.privacy') }}</p>
          <p v-if="isWeb && disconnected" role="status" class="text-sm text-on-surface-variant">{{ t('web.disconnected') }}</p>
          <p v-if="store.videoInfo?.parseNotice" role="status" class="text-sm text-on-surface-variant">{{ store.videoInfo.parseNotice }}</p>

          <FormatSelector
            v-if="store.videoInfo"
            :video-info="store.videoInfo"
            :selected-format="store.selectedFormat"
            :selected-audio-format="store.selectedAudioFormat"
            :selected-audio-track="store.selectedAudioTrack"
            :selected-subtitles="store.selectedSubtitles"
            :download-mode="store.downloadMode"
            :is-downloading="store.isDownloading"
            @select-video="store.selectVideoFormat"
            @select-audio="store.selectAudioFormat"
            @select-track="store.selectAudioTrack"
            @select-subtitle="store.selectSubtitle"
            @download="store.startDownload"
          />
        </div>
      </div>

      <!-- Progress Bar -->
      <div
        v-if="store.isParsing"
        class="sticky bottom-0 left-0 w-full bg-surface-container-low/95 backdrop-blur-md border-t border-outline-variant/15 px-8 py-3.5 z-20 shadow-sticky-up"
      >
        <div class="max-w-xl mx-auto flex flex-col gap-2">
          <div class="flex justify-between items-center text-[12px] font-semibold">
            <div class="flex items-center gap-2 text-primary">
              <MaterialIcon name="sync" :size="16" class="animate-spin" />
              <span class="tracking-wide">{{ t('download.extracting') }}</span>
            </div>
            <!-- 解析没有可用的进度来源，因此不显示百分比，避免给出不真实的数字 -->
            <span class="text-on-surface-variant font-normal">{{ parseElapsedText }}</span>
          </div>
          <!-- 不确定进度条：只表示"正在进行"，不假装知道进度 -->
          <div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div class="h-full w-1/3 bg-[#FFB347] rounded-full animate-parse-bar shadow-[0_0_8px_rgba(255,179,71,0.4)]" />
          </div>
        </div>
      </div>
    </section>

    <!-- Right Panel -->
    <DownloadQueue />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import UrlInput from './UrlInput.vue'
import FormatSelector from './FormatSelector.vue'
import DownloadQueue from './DownloadQueue.vue'
import { useDownloadStore } from '../stores/download'
import { t } from '../i18n'
import { isWeb } from '../runtime-mode'
import { useDepsStore, readMissingKinds, stripDepMarkers } from '../stores/deps'
import { readSettings } from '../stores/settings'
import { useErrorModal } from '../composables/useErrorModal'
import { classifyParseError, parseDiagnostic, PARSE_MESSAGES } from '../../shared/parse-error'
import { readWebPrefill } from '../../shared/web-prefill'
import type { ParseErrorKind } from '../../shared/parse-error'

const store = useDownloadStore()
const { showError } = useErrorModal()
const disconnected = ref(false)
const retryBlock = ref<{ url: string; until: number; session: boolean } | null>(null)
const retryClock = ref(Date.now())
let retryTimer: ReturnType<typeof setInterval> | undefined
const retrySeconds = computed(() => {
  const block = retryBlock.value
  return block && (block.session || block.url === extractUrl(store.url)) ? Math.max(0, Math.ceil((block.until - retryClock.value) / 1000)) : 0
})
let unsubscribeHistory: (() => void) | undefined
let unsubscribeProgress: (() => void) | undefined
function connectionChanged(event: Event) { disconnected.value = (event as CustomEvent).detail !== 'connected' }

// 解析阶段拿不到真实进度（yt-dlp 只在下载阶段输出进度行），
// 因此不显示百分比，改为不确定进度条 + 已用时间。
const parseElapsed = ref(0)
const parseElapsedText = computed(() =>
  parseElapsed.value > 0 ? t('download.elapsed', { seconds: parseElapsed.value }) : t('download.usuallySeconds'),
)

function extractUrl(text: string): string {
  const cleanText = text.replace(/锟斤拷|锟|斤|拷/g, '').trim()
  const patterns = [
    /https:\/\/v\.douyin\.com\/[a-zA-Z0-9_\-]+/i,
    /https:\/\/www\.xiaohongshu\.com\/discovery\/item\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+[^\s`]*/i,
    /https:\/\/b23\.tv\/[a-zA-Z0-9]+/i,
    /https:\/\/(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)/i,
    /https:\/\/(www\.)?instagram\.com\/[^\s]+/i,
    /https?:\/\/[^\s\u4e00-\u9fa5]+/i,
  ]
  for (const p of patterns) {
    const match = cleanText.match(p)
    if (match) {
      if (p.source.includes('youtube') && match[1]) return 'https://' + match[1] + match[2]
      return match[0]
    }
  }
  return cleanText
}

function isBilibiliUrl(url: string): boolean {
  return url.includes('bilibili.com') || url.includes('b23.tv')
}

async function fetchBilibiliThumbnail(thumbnailUrl: string) {
  try {
    const base64Image = await window.electronAPI.app.fetchImage(thumbnailUrl, 'https://www.bilibili.com/')
    if (base64Image && store.videoInfo) {
      store.videoInfo.thumbnail = base64Image
    }
  } catch {}
}

async function parseVideo() {
  if (!store.url || store.isParsing || retrySeconds.value) return

  store.hasParsed = true
  const extractedUrl = extractUrl(store.url)
  if (extractedUrl !== store.url) store.url = extractedUrl
  const requestedUrl = store.url

  // 预校验 URL 格式
  try {
    const parsed = new URL(store.url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      showError(t('download.invalidLink'), t('download.badProtocol', { protocol: parsed.protocol }))
      return
    }
  } catch {
    showError(t('download.invalidLink'), t('download.badUrl', { url: store.url }))
    return
  }

  store.isParsing = true
  store.parseProgress = 0
  parseElapsed.value = 0
  store.videoInfo = null
  store.selectedFormat = null

  const settings = readSettings()
  const cookieMode = settings.cookieMode
  const cookiesFile = cookieMode === 'manual' ? settings.cookiesFile : ''
  const proxy = settings.proxy

  // 解析阶段无法获知真实进度（yt-dlp 只在下载阶段输出进度行），
  // 因此这里只做两件事：显示一个不确定进度条 + 记录已用时间。
  const startedAt = Date.now()
  const elapsedTimer = setInterval(() => {
    parseElapsed.value = Math.round((Date.now() - startedAt) / 1000)
  }, 1000)
  const clearElapsed = () => clearInterval(elapsedTimer)

  try {
    const info = await window.electronAPI.ytdlp.parse(store.url, cookiesFile, proxy)
    store.videoInfo = info

    if (isBilibiliUrl(store.url) && info.thumbnail) {
      fetchBilibiliThumbnail(info.thumbnail)
    }

    if (info.formats?.length) {
      store.selectedFormat = info.formats[0]
      store.downloadMode = 'video'
    } else if (info.audioFormats?.length) {
      store.selectedAudioFormat = info.audioFormats[0]
      store.downloadMode = 'audio'
    }

    if (info.audioTracks?.length) {
      const defaultTrack = info.audioTracks.find((t: any) => t.name?.toLowerCase().includes('default') || t.language === 'original')
      store.selectedAudioTrack = defaultTrack || info.audioTracks[0]
    } else {
      store.selectedAudioTrack = null
    }

    clearElapsed()
    store.parseProgress = 100
  } catch (e: any) {
    clearElapsed()
    if (isWeb) {
      if (Number.isSafeInteger(e.retryAfterSeconds) && e.retryAfterSeconds > 0) {
        retryClock.value = Date.now()
        retryBlock.value = { url: requestedUrl, until: retryClock.value + Math.min(e.retryAfterSeconds, 86400) * 1000, session: e.code === 'parse-quota' }
        clearInterval(retryTimer)
        retryTimer = setInterval(() => {
          retryClock.value = Date.now()
          if (retryBlock.value && retryClock.value >= retryBlock.value.until) { retryBlock.value = null; clearInterval(retryTimer) }
        }, 1000)
      }
      const kind = Object.prototype.hasOwnProperty.call(PARSE_MESSAGES, e.code) ? e.code as ParseErrorKind : undefined
      showError(e.message || t('web.requestFailed'), '', '', kind)
      return
    }
    // 主进程可能在错误后附带 Cookie 读取失败的解决建议，分类时只看错误本身
    const [rawError, hint = ''] = (e.message || t('download.unknownError')).split('\n\n提示：')
    // 缺少运行依赖时直接弹「一键下载」引导，比只弹错误框更有用
    if (!isWeb && (rawError.includes('[deps-missing:') || /未找到可用的 (yt-dlp|ffmpeg|ffprobe)/.test(rawError))) {
      useDepsStore().promptForMissing(readMissingKinds(rawError))
      store.isParsing = false
      return
    }
    const sanitized = stripDepMarkers(rawError)
    const kind = classifyParseError(sanitized)
      // 把类别一并传给弹窗：它据此决定是否给「提交 Issue」入口
      // （authentication / invalid-url 这类不给，否则会生成空 Issue）
      showError(t('download.parseFailed', { message: PARSE_MESSAGES[kind] }), parseDiagnostic(sanitized), hint, kind)
  } finally {
    store.isParsing = false
  }
}

async function loadDownloadDir() {
  const settings = readSettings()
  if (settings.downloadDir) {
    store.downloadDir = settings.downloadDir
    return
  }
  store.downloadDir = await window.electronAPI.app.getDefaultDownloadDir()
}

onMounted(async () => {
  if (isWeb) {
    // 官网首屏表单带来的链接：挂载时同步预填，不能等 WebSocket 历史同步，否则输入框会空白数秒
    const prefill = readWebPrefill(location.href, document.referrer)
    if (prefill) {
      history.replaceState(history.state, '', prefill.cleanUrl)
      if (!store.url.trim()) store.url = prefill.url
    }
    window.addEventListener('keep:connection', connectionChanged)
    unsubscribeHistory = window.electronAPI?.history?.onUpdated(store.syncWebTasks)
    unsubscribeProgress = window.electronAPI?.onDownloadProgress(data => {
      const task = store.downloadTasks.find(item => item.id === data.taskId)
      if (task && ['pending', 'downloading', 'merging'].includes(task.status)) {
        task.progress = data.percent || 0
        task.status = data.status === 'merging' ? 'merging' : 'downloading'
        task.speed = data.speed; task.eta = data.eta
      }
    })
    // 同站提交才自动解析；请求本身会等待连接，无需排在历史同步之后
    if (prefill?.autoParse && store.url === prefill.url) void parseVideo()
    try { store.syncWebTasks(await window.electronAPI.history.get()) } catch { disconnected.value = true }
  }
  await loadDownloadDir()
  // 应用代理设置
  const settings = readSettings()
  if (!isWeb && settings.proxy) {
    window.electronAPI.app.setProxy(settings.proxy)
  }
  window.addEventListener('tab-changed', async (e: any) => {
    if (e.detail === 'download') await loadDownloadDir()
  })
})
onUnmounted(() => { clearInterval(retryTimer); unsubscribeHistory?.(); unsubscribeProgress?.(); window.removeEventListener('keep:connection', connectionChanged) })
</script>
