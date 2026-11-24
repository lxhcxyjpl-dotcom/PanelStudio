# Install and start

PanelStudio v0.1 is a local or self-hosted web app. The API listens on the loopback address. The browser talks to the Vite dev server, which proxies `/api` to that API, so the page and the API are same-origin.

Tested here with Node.js 22.23.4 and pnpm 10.33.4. The package requires Node.js `>=22.12.0` and pins pnpm `10.33.4` in `packageManager`.

## Install

```bash
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm install --frozen-lockfile
```

`pnpm-lock.yaml` is the reproducible install. English and Simplified Chinese OCR data are included in the dependencies. After installation, local reading works without downloading a model or entering an API key. Configure an image-capable provider in **Settings → AI connection** to enable cloud reading.

## Start

Two processes. In one terminal:

```bash
pnpm --filter @panelstudio/server exec node start.mjs
```

The API listens on `127.0.0.1` and port `3001` unless `PORT` is set. In a second terminal, from the repository root:

```bash
pnpm --filter @panelstudio/web dev
```

Open `http://127.0.0.1:5173`. `PANELSTUDIO_API` overrides the proxy target. The default is `http://127.0.0.1:3001`.

Checks that do not need the servers:

```bash
pnpm typecheck
pnpm test
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

`pnpm build:web` writes `apps/web/dist` and copies the four Noto files into `dist/fonts`. A self-hosted deployment serves that directory at `/` and forwards `/api` to the API. There is no single-process production binary in v0.2. Put any public hostname behind the reverse proxy you already use for authentication. Do not expose the API without that proxy. The app does not add Redis, accounts, or multi-user collaboration.

## Data directory

The default data directory is `$HOME/.panelstudio`. Set `DATA_DIR` to move it. Keep it outside the git checkout.

That directory holds:

- `panelstudio.sqlite` and its WAL files
- `blobs/` for originals, normalized assets, thumbnails, and exports
- `master.key`, created the first time a model-provider secret is saved

`master.key` is the 32-byte AES-256-GCM key for the provider secret. The POSIX file mode is `0600`. Windows access follows the data directory’s permissions. It is not part of a `.figurezip`, and it is not returned by the API. Losing it makes a stored provider secret unreadable. Figure projects in the same directory stay readable.

Never commit `master.key`. `.gitignore` ignores that filename, `.panelstudio/`, and `data/`. Do not copy the key into docs, fixtures, or CI. The end-to-end script sets `DATA_DIR` to a temporary directory so a test run does not write the home-directory database.

AI is optional. Import, layout, editing, and export work with no provider and no `master.key`.

## 安装与启动

需要 Node.js 22.12 或更新，以及 pnpm 10.33.4。

```bash
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm install --frozen-lockfile
pnpm --filter @panelstudio/server exec node start.mjs
```

另一个终端：

```bash
pnpm --filter @panelstudio/web dev
```

浏览器打开 `http://127.0.0.1:5173`。

数据目录默认是 `$HOME/.panelstudio`，可用 `DATA_DIR` 改到仓库以外的位置。其中的 `master.key` 只用于加密模型密钥，在 POSIX 系统上使用 `0600` 权限，Windows 上的访问由数据目录权限控制。不要提交这个文件。不配置 AI 时，导入、排版、编辑和导出仍然可用。


## Windows

Use the pnpm version in the root package manifest. In an environment with multiple pnpm versions, put the Corepack shim first on PATH so that nested package scripts use the same version. The pinned SQLite package includes its Windows x64 native binary. Its optional source build is disabled for this workspace. For browser tests run `pnpm exec playwright install chromium` once. Integration tests need a temporary directory where the current user can rename files.

The default data directory is shared between releases. An existing SQLite database is backed up under `backups/` before the v0.2 migration. To run an independent demonstration, set `DATA_DIR` to a new directory when starting the API.
