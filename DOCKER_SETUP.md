# Dev3000 Docker セットアップガイド（WSL対応版）

このガイドでは、Dev3000とNext.js 15を同一Dockerコンテナで動かし、ホストのChrome（CDP）で自動操作する環境のセットアップ方法を説明します。

## 📋 完了した設定

以下のファイルが既に設定されています：

### 1. Docker設定
- ✅ `docker/Dockerfile` - Node.js 20 Bookworm Slim ベース、非root実行
- ✅ `docker/docker-compose.yml` - 単一コンテナ構成、WSL対応（host-gateway）
- ✅ `docker/README.md` - 詳細なセットアップドキュメント

### 2. Next.js 15 サンプル
- ✅ `example/nextjs15/package.json` - Next.js 15依存関係
- ✅ `example/nextjs15/pages/index.js` - 最小ページ
- ✅ `example/nextjs15/next.config.js` - Next.js設定

### 3. 自動化ツール
- ✅ `tools/dev3000-up.mjs` - Chrome起動 + Docker Compose起動（WSL対応）
- ✅ `tools/dev3000-down.mjs` - Docker Compose停止
- ✅ `package.json` - npm scripts追加（`dev3000:up`, `dev3000:down`）

### 4. CDP切替実装
- ✅ `src/cdp-monitor.ts` - CDP切替ロジック実装済み
  - `DEV3000_CDP=1` でホストChrome接続
  - `DEV3000_CDP_URL` でCDP URL指定

## 🚀 使い方

### クイックスタート（推奨）

```bash
# リポジトリルートで実行
npm run dev3000:up
```

このコマンドは以下を自動実行します：
1. ホストのChromeを起動（CDP有効、ポート9222）
2. Docker Composeでコンテナをビルド・起動

### アクセスURL

起動後、以下にアクセス可能：
- **Next.js アプリ**: <http://localhost:3000>
- **Dev3000 UI**: <http://localhost:3684>
- **Dev3000 ログ**: <http://localhost:3684/logs>

### 停止

```bash
npm run dev3000:down
```

## 🔧 主な改善点

### 1. WSL互換性
- `extra_hosts: host-gateway` でLinux/WSL環境でも`host.docker.internal`が使用可能
- Chrome検索順序を最適化（WSLではWindows版Chromeを優先）
  - `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`
  - Snap/FlatpakのChrome（CDP制約の可能性）を回避

### 2. ビルドコンテキスト修正
変更前（誤り）:
```yaml
build:
  context: .
  dockerfile: Dockerfile
```

変更後（正しい）:
```yaml
build:
  context: ..
  dockerfile: docker/Dockerfile
```

### 3. パス修正
コマンド内のパスを修正：
- `/workspace/dev3000/` → `/workspace/`（ルートが直接マウントされるため）

### 4. ボリューム最適化
```yaml
volumes:
  - ../:/workspace:cached           # ソースコード（キャッシュ有効）
  - dev3000_node_modules:/workspace/node_modules
  - next_node_modules:/workspace/example/nextjs15/node_modules
```

## 🛡️ セキュリティ対策

実装済みのセキュリティ機能：
- ✅ 非rootユーザー実行（`USER node`）
- ✅ 不要な権限削除（`cap_drop: ALL`）
- ✅ 新規特権取得の無効化（`no-new-privileges:true`）
- ✅ ヘルスチェック実装

## 🐛 トラブルシューティング

### ポート競合エラー

既存のコンテナが3000または3684を使用している場合：

```bash
# 既存のコンテナを停止
docker ps -a | grep dev3000
docker stop <container_id>
docker rm <container_id>
```

または `docker-compose.yml` でポートを変更：
```yaml
ports:
  - "3001:3000"  # 3000 → 3001 に変更
  - "3685:3684"  # 3684 → 3685 に変更
```

### Chrome CDP接続エラー

**症状**: `Failed to connect to CDP`

**解決策**:
1. Chromeが起動しているか確認：
   ```bash
   curl http://localhost:9222/json
   ```

2. WSLでホストWindowsのIPを使用：
   ```bash
   # WSLからWindowsホストのIPを取得
   ip route show | grep default | awk '{print $3}'
   ```

   `docker-compose.yml` で設定：
   ```yaml
   environment:
     DEV3000_CDP_URL: "http://172.27.96.1:9222"  # 実際のIP
   ```

### Snap/Flatpak Chromeの問題

**症状**: ChromeがCDP接続を受け付けない

**解決策**: Windows版Chrome（WSL）または通常パッケージ版を使用

```bash
# WSL環境で推奨
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/dev3000-chrome &
```

### ホットリロードが遅い

**原因**: WSL環境でのファイル監視

**解決策**: 既に設定済み
- `CHOKIDAR_USEPOLLING: "true"`
- `WATCHPACK_POLLING: "true"`

ポーリング間隔を調整する場合は環境変数を追加：
```yaml
CHOKIDAR_INTERVAL: "2000"  # 2秒
```

## 📝 手動起動（デバッグ用）

自動化スクリプトを使わない場合：

### 1. Chrome起動

**macOS:**
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/dev3000-chrome &
```

**Windows PowerShell:**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=0.0.0.0 `
  --user-data-dir=$env:TEMP\dev3000-chrome
```

**Linux/WSL:**
```bash
# Windows版Chrome（推奨）
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/dev3000-chrome &

# または Linux版
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/dev3000-chrome &
```

### 2. Docker Compose起動

```bash
cd docker
docker compose up --build
```

### 3. ログ確認

別のターミナルで：
```bash
docker compose logs -f dev3000
```

## 🔍 動作確認

### 1. コンテナの状態確認

```bash
docker ps | grep dev3000
# STATUS が "Up" かつ "(healthy)" であることを確認
```

### 2. ヘルスチェック確認

```bash
# Dev3000 UIの確認
curl http://localhost:3684/health

# Next.jsの確認
curl http://localhost:3000
```

### 3. ログ確認

```bash
# Dev3000のログをブラウザで確認
open http://localhost:3684/logs

# またはターミナルで
docker compose logs dev3000 --tail=50 -f
```

## 📊 アーキテクチャ図

```text
┌──────────────────────────────────────────────────────┐
│ ホスト（WSL / Linux / macOS / Windows）               │
│                                                      │
│  ┌────────────────┐                                 │
│  │ Chrome         │ :9222 (CDP)                     │
│  │ --remote-debugging-port=9222                     │
│  └────────────────┘                                 │
│         ▲                                            │
│         │ CDP over host.docker.internal:9222        │
│         │                                            │
│  ┌──────┴─────────────────────────────────────┐    │
│  │ Docker Container (dev3000)                  │    │
│  │                                              │    │
│  │  ┌────────────────────────────────────┐    │    │
│  │  │ Dev3000 (Node.js)           :3684  │    │    │
│  │  │                                     │    │    │
│  │  │  ├─ CDP Monitor (cdp-monitor.ts)  │    │    │
│  │  │  │   └─ connects to host Chrome   │    │    │
│  │  │  │                                  │    │    │
│  │  │  └─ Child Process:                 │    │    │
│  │  │      ┌────────────────────────┐   │    │    │
│  │  │      │ Next.js 15      :3000  │   │    │    │
│  │  │      │ (npm run dev)          │   │    │    │
│  │  │      └────────────────────────┘   │    │    │
│  │  │                                     │    │    │
│  │  └─────────────────────────────────────┘    │    │
│  │                                              │    │
│  │  Volumes:                                    │    │
│  │  - /workspace (source code)                 │    │
│  │  - dev3000_node_modules                     │    │
│  │  - next_node_modules                        │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  アクセス:                                            │
│  - http://localhost:3000 → Next.js                  │
│  - http://localhost:3684 → Dev3000 UI              │
└──────────────────────────────────────────────────────┘
```

## 🔄 開発ワークフロー

### コード変更の反映

1. ホスト側でファイルを編集
   ```bash
   # 例: example/nextjs15/pages/index.js を編集
   ```

2. ホットリロードで自動反映（数秒待つ）
   - Dev3000がファイル変更を検知
   - Next.jsが自動リビルド
   - ブラウザが自動リロード

3. ログでビルド状況を確認
   ```bash
   # ブラウザで確認
   open http://localhost:3684/logs
   ```

### スクリーンショット確認

Dev3000は自動的にスクリーンショットを撮影：
- ページロード時
- エラー発生時
- ユーザー操作後（クリック、スクロールなど）

```bash
# スクリーンショット一覧
open http://localhost:3684/api/screenshots
```

## 📚 参考リンク

- [Docker Compose公式ドキュメント](https://docs.docker.com/compose/)
- [Chrome DevTools Protocol](https://chromerdevtools.github.io/devtools-protocol/)
- [Next.js公式ドキュメント](https://nextjs.org/docs)
- [Dev3000リポジトリ](https://github.com/vercel-labs/dev3000)

## 🤝 コントリビューション

問題や改善提案がある場合：
1. GitHubでIssueを作成
2. プルリクエストを送信

---

**注意**: このセットアップは開発環境専用です。本番環境では使用しないでください。
