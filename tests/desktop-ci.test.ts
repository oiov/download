import { describe, expect, it } from 'vitest'
import { desktopDiffArgs, needsDesktopBuild } from '../scripts/desktop-ci.mjs'

describe('桌面打包路径筛选', () => {
  it.each([
    'website/content.mjs',
    'website/assets/hero.png',
    'docker/server/index.ts',
    'docker/web/vite.config.ts',
    'docker/Dockerfile',
    'docker-compose.yml',
    '.dockerignore',
    'docs/server-deployment.md',
    'README.md',
    'CHANGELOG.md',
    'AGENTS.md',
    'CLAUDE.md',
    'scripts/build-website.mjs',
    'scripts/test-web-server.mjs',
    'scripts/analytics-report.ts',
    'tests/web-analytics.test.ts',
    '.github/workflows/docker.yml',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
  ])('仅修改 %s 不打包桌面版', file => {
    expect(needsDesktopBuild([file])).toBe(false)
  })

  it.each([
    'app/main.go',
    'app/frontend/src/App.svelte',
    'app/sidecar/cmd/keepvideo-deps/main.go',
    'app/build/darwin/Info.plist',
    'scripts/sync-changelog.mjs',
    'src/App.vue',
    'src/i18n/web-locales.json',
    'electron/download/ytdlp.ts',
    'backend/internal/manifest/assets.gen.go',
    'shared/web-routes.ts',
    'shared/acceleration.ts',
    'public/logo.png',
    'build/icon.png',
    'index.html',
    'ldstore.ico',
    'LICENSE',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.gitattributes',
    'vite.config.ts',
    'postcss.config.js',
    'tsconfig.json',
    'tsconfig.node.json',
    'electron-builder.json5',
    'scripts/build-backend.sh',
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
  ])('修改 %s 必须打包桌面版', file => {
    expect(needsDesktopBuild([file])).toBe(true)
  })

  it('混合变更不能因包含官网文件而漏掉共享代码', () => {
    expect(needsDesktopBuild(['website/content.mjs', 'shared/app.ts'])).toBe(true)
  })

  it('支持 Windows 路径分隔符，但不匹配相似的目录名', () => {
    expect(needsDesktopBuild(['electron\\download\\ytdlp.ts'])).toBe(true)
    expect(needsDesktopBuild(['docker\\server\\index.ts'])).toBe(false)
    expect(needsDesktopBuild(['src-other/file.ts', 'shared-docs/guide.md', 'apps/readme.md'])).toBe(false)
  })

  it('空提交不重复打包', () => {
    expect(needsDesktopBuild([])).toBe(false)
  })
})

describe('桌面打包变更范围', () => {
  const base = 'a'.repeat(40)
  const head = 'b'.repeat(40)

  it('push 比较推送前后，覆盖一次推送中的所有提交', () => {
    expect(desktopDiffArgs('push', { before: base, after: head })).toEqual([
      'diff', '--name-only', '--no-renames', '-z', base, head, '--',
    ])
  })

  it('PR 使用合并基点，避免将目标分支的新提交算作 PR 改动', () => {
    expect(desktopDiffArgs('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } })).toEqual([
      'diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--',
    ])
  })

  it.each(['workflow_dispatch', 'workflow_call', 'unknown'])('%s 保守执行完整打包', event => {
    expect(desktopDiffArgs(event, {})).toBeNull()
  })

  it('新分支首次推送、缺失或非法范围不允许跳过打包', () => {
    expect(desktopDiffArgs('push', { before: '0'.repeat(40), after: head })).toBeNull()
    expect(desktopDiffArgs('push', {})).toBeNull()
    expect(desktopDiffArgs('pull_request', {})).toBeNull()
    expect(desktopDiffArgs('push', { before: '--output=bad', after: head })).toBeNull()
  })
})
