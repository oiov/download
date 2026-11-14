# Keep Video

把视频、音频与字幕保存到电脑的开源桌面工具，支持 macOS、Windows 和 Linux。

[下载安装包](https://github.com/oiov/keep.video/releases) · [反馈问题](https://github.com/oiov/keep.video/issues)

![Keep Video](website/assets/app-preview.png)

## 功能

- 解析视频链接，选择来源提供的画质和格式。
- 保存音频和字幕，管理下载队列与本地文件。
- 在应用内配置 yt-dlp 和 FFmpeg，也可复用兼容的系统安装。
- 中英文界面，通过本仓库获取更新。

请仅下载自己拥有或已获授权的内容。

## 安装

在 Releases 选择对应系统和处理器的安装包。macOS 分 Apple 芯片和 Intel 版本，Windows 使用 x64，Linux 按架构与包格式选择。

首次启动按提示配置运行依赖。部分 YouTube 来源需要 Node.js 或 Deno。当前安装包尚未签名和公证，系统可能显示安全提示。

## 开发

需要 Node.js 22.13+、pnpm 和 Go 1.24+。

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
```

开发约定见 [AGENTS.md](AGENTS.md)。

## 官网

```sh
node scripts/build-website.mjs
node scripts/serve-website.mjs
```

访问 http://localhost:4179。部署说明见 [Cloudflare Workers](docs/website-deployment.md)。

## 许可与致谢

[MIT](LICENSE)。基于 yxxbc 的 [DownVid](https://github.com/yxxbc/downvid) 和 cshuangyy 的 [Videdown](https://github.com/cshuangyy/videdown)，保留原始版权声明。yt-dlp 和 FFmpeg 遵循各自许可证。
