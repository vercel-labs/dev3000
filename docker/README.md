# Dev3000 × Next.js 15 Docker Setup

このディレクトリには、Dev3000とNext.js 15を同一コンテナで動かすためのDocker設定が含まれています。

## 特徴

- ✅ 単一コンテナ構成（Dev3000がNext.jsを子プロセスとして起動）
- ✅ ホストのChrome（CDP）で自動操作・自動スクショ
- ✅ WSL/Linux/macOS/Windows対応
- ✅ セキュア（非root、権限制限、ヘルスチェック）
- ✅ ホットリロード対応（ポーリングによるFS変更検知）

## 前提条件

1. Docker（Desktop/Engine）と Docker Compose v2 がインストールされていること
2. ホストにGoogle Chromeがインストールされていること
   - Linux: `/usr/bin/google-chrome` または `/usr/bin/chromium`
   - macOS: `/Applications/Google Chrome.app/`
   - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
   - WSL: Windows版Chrome（`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`）を推奨

## クイックスタート

### 方法1: npm スクリプト（推奨）

リポジトリルートで：

```bash
# 起動（Chrome自動起動 + Docker Compose起動）
npm run dev3000:up

# 停止
npm run dev3000:down
```

### 方法2: 手動起動

1. Chromeを起動（CDP有効化）：

**macOS:**
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/dev3000-chrome &
```

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=0.0.0.0 `
  --user-data-dir=$env:TEMP\dev3000-chrome
```

**Linux/WSL:**
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/dev3000-chrome &
```

2. Docker Composeを起動：

```bash
cd docker
docker compose up --build
```

## アクセス

起動後、以下のURLにアクセスできます：

- Next.js アプリ: http://localhost:3000
- Dev3000 UI: http://localhost:3684
- Dev3000 ログ: http://localhost:3684/logs

## 環境変数

`docker-compose.yml`で設定されている主な環境変数：

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `DEV3000_CDP` | `1` | CDP経由でホストChromeに接続 |
| `DEV3000_CDP_URL` | `http://host.docker.internal:9222` | CDP接続先URL |
| `FRONTEND_PORT` | `3000` | Next.jsのポート |
| `DEV3000_PORT` | `3684` | Dev3000 UIのポート |
| `CHOKIDAR_USEPOLLING` | `true` | ホットリロード安定化 |
| `WATCHPACK_POLLING` | `true` | Webpackポーリング有効化 |

## トラブルシューティング

### Chromeが見つからない

`tools/dev3000-up.mjs`が警告を出す場合、手動でChromeを起動してください（上記参照）。

### CDP接続エラー

`host.docker.internal`が使えない環境（古いLinux）の場合：

```yaml
# docker-compose.ymlで変更
DEV3000_CDP_URL: "http://172.17.0.1:9222"  # Docker bridge IP
```

または `extra_hosts` を確認：
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"  # Linuxで必要
```

### ホットリロードが動かない

1. `CHOKIDAR_USEPOLLING=true` と `WATCHPACK_POLLING=true` が設定されているか確認
2. ボリュームマウントに `:cached` オプションが付いているか確認
3. ファイル変更後、数秒待つ（ポーリング間隔）

### ポートが既に使用されている

他のサービスが3000または3684を使用している場合、`docker-compose.yml`のポート設定を変更：

```yaml
ports:
  - "3001:3000"  # ホスト:コンテナ
  - "3685:3684"
```

### WSL環境でのSnap/Flatpak Chrome

SnapやFlatpakでインストールされたChromeはCDP制約がある場合があります。
Windows版Chromeを使用することを推奨（`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`）。

## セキュリティ注意事項

- ⚠️ CDP（ポート9222）は無認証です。開発環境のみで使用してください
- ⚠️ 本番環境では使用しないでください
- ✅ Dockerコンテナは非rootユーザーで実行されます
- ✅ 不要な権限は削除されています（`cap_drop: ALL`）

## アーキテクチャ

```
┌─────────────────────────────────────────┐
│ ホスト（WSL/Linux/macOS/Windows）        │
│                                         │
│  Chrome (CDP:9222) ←────────┐          │
│                              │          │
│  ┌─────────────────────────┐│          │
│  │ Docker Container        ││          │
│  │                         ││          │
│  │  Dev3000 (3684) ────────┘│          │
│  │    └─→ Next.js (3000)    │          │
│  │                           │          │
│  └───────────────────────────┘          │
└─────────────────────────────────────────┘
```

## 詳細仕様

- **Dockerfile**: Node.js 20 Bookworm Slim ベース
- **プロセス管理**: Dev3000が単一プロセスとしてNext.jsを子プロセス起動
- **ログ統合**: Next.jsの起動ログ・ランタイムログをDev3000が取り込み
- **ボリューム**: 名前付きボリュームで`node_modules`をキャッシュ
- **ヘルスチェック**: Dev3000 UIまたはNext.jsの応答で確認

## カスタマイズ

### Next.jsアプリの変更

`example/nextjs15/` ディレクトリ内のファイルを編集：

- `pages/` - ページコンポーネント
- `package.json` - 依存関係
- `next.config.js` - Next.js設定

### Dev3000の設定変更

`docker-compose.yml`の`command`セクションでCLIオプションを変更：

```yaml
command: >
  bash -lc "
    cd /workspace &&
    npm run build &&
    cd /workspace/example/nextjs15 &&
    npm ci &&
    node /workspace/dist/cli.js \
      --port ${FRONTEND_PORT} \
      --mcp-port ${DEV3000_PORT} \
      --debug  # デバッグモード追加
  "
```

## ライセンス

MIT
