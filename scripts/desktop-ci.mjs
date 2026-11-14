#!/usr/bin/env node

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// 渲染进程与下载内核由桌面和 Web 共用，不能因为在线端也引用就排除。
const DESKTOP_DIRS = ['app/', 'src/', 'electron/', 'backend/', 'shared/', 'public/', 'build/']
const DESKTOP_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.pnpmfile.cjs',
  '.node-version',
  '.nvmrc',
  '.gitattributes',
  'index.html',
  'vite.config.ts',
  'postcss.config.js',
  'tsconfig.json',
  'tsconfig.node.json',
  'electron-builder.json5',
  'ldstore.ico',
  'LICENSE',
  'scripts/build-backend.sh',
  'scripts/sync-changelog.mjs',
  'scripts/gen-deps-manifest.mjs',
  'scripts/gen-update-manifests.mjs',
  'scripts/gen-release-notes.mjs',
  'scripts/test-package-contents.mjs',
  'scripts/lib/harness.mjs',
  'scripts/desktop-ci.mjs',
  'scripts/lint-workflows.mjs',
  'tests/desktop-ci.test.ts',
  '.github/workflows/ci-linux.yml',
  '.github/workflows/ci-macos.yml',
  '.github/workflows/ci-windows.yml',
  '.github/workflows/desktop-changes.yml',
  '.github/workflows/release.yml',
])

export function needsDesktopBuild(files) {
  return files.some(file => {
    const normalized = file.replaceAll('\\', '/')
    return DESKTOP_FILES.has(normalized) || DESKTOP_DIRS.some(dir => normalized.startsWith(dir))
  })
}

export function desktopDiffArgs(eventName, event) {
  let base
  let head
  let range
  if (eventName === 'push') {
    base = event.before
    head = event.after
    range = [base, head]
  } else if (eventName === 'pull_request') {
    base = event.pull_request?.base?.sha
    head = event.pull_request?.head?.sha
    range = [`${base}...${head}`]
  } else {
    // 手动运行及未知事件都执行完整打包，不受路径过滤影响。
    return null
  }
  const validSha = value => typeof value === 'string' && /^[a-f\d]{40}$/i.test(value) && !/^0+$/.test(value)
  if (!validSha(base) || !validSha(head)) return null
  // 禁用重命名识别，让移出桌面目录的文件同时以删除旧路径、增加新路径参与判断。
  return ['diff', '--name-only', '--no-renames', '-z', ...range, '--']
}

function main() {
  let desktop = true
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    const args = desktopDiffArgs(process.env.GITHUB_EVENT_NAME, event)
    if (args) {
      const changed = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      desktop = needsDesktopBuild(changed.split('\0').filter(Boolean))
    }
  } catch {
    // 首次推送、历史不可达或检测失败时宁可多打包，不能漏掉桌面变更。
    console.warn('无法确认完整变更范围，保守执行桌面打包。')
  }
  console.log(desktop ? '检测到桌面相关变更或需完整校验，执行桌面打包。' : '没有桌面相关变更，跳过桌面打包；其余测试照常执行。')
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `desktop=${desktop}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
