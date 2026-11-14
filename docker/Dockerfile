# 一个镜像同时包含 SEO 门户、在线工具与下载引擎。
FROM golang:1.24-bookworm AS backend
WORKDIR /src
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /downvid-deps ./cmd/downvid-deps
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
ARG SITE_URL=https://keep.video
RUN pnpm build:web
RUN pnpm exec esbuild docker/server/index.ts --bundle --platform=node --format=esm --packages=external --alias:electron=./docker/server/electron-shim.ts --outfile=/app/server.mjs
RUN pnpm exec esbuild scripts/analytics-report.ts --bundle --platform=node --format=esm --outfile=/app/analytics-report.mjs
RUN pnpm exec esbuild scripts/admin-report.ts --bundle --platform=node --format=esm --outfile=/app/admin-report.mjs
FROM node:22-bookworm-slim
# 使用 Node 22.13+ 内置 SQLite；不安装第三方原生数据库模块。
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates curl ffmpeg tini python3 && rm -rf /var/lib/apt/lists/*
COPY backend/internal/manifest/assets.gen.go /tmp/deps-manifest.go
RUN set -eu; \
    version=$(sed -n 's/^const YtDlpTag = "\([^"]*\)"/\1/p' /tmp/deps-manifest.go); \
    sha256=$(sed -n 's/^const YtDlpZipappSHA256 = "\([^"]*\)"/\1/p' /tmp/deps-manifest.go); \
    test -n "$version" && test "${#sha256}" -eq 64; \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/$version/yt-dlp" -o /usr/local/bin/yt-dlp; \
    printf '%s  %s\n' "$sha256" /usr/local/bin/yt-dlp | sha256sum -c -; \
    chmod +x /usr/local/bin/yt-dlp; \
    yt-dlp --version; \
    rm /tmp/deps-manifest.go
WORKDIR /app
COPY docker/package.json docker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/analytics-report.mjs ./analytics-report.mjs
COPY --from=build /app/admin-report.mjs ./admin-report.mjs
COPY --from=build /app/website/dist ./website/dist
COPY --from=build /app/docker/dist-web ./docker/dist-web
COPY --from=backend /downvid-deps ./backend/build/downvid-deps
ENV APP_ROOT=/app DOWNVID_WEB_HOST=0.0.0.0 DOWNVID_WEB_PORT=6080 DOWNVID_DATA_DIR=/data/userdata DOWNVID_DOWNLOADS=/data/downloads
RUN mkdir -p /data/userdata /data/downloads && chown -R node:node /data
USER node
EXPOSE 6080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:6080/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
