# Add Docker and WSL support for Dev3000 + Next.js 15

## 概要

Dev3000とNext.js 15を同一Dockerコンテナで動作させ、ホストのChrome（CDP）で自動操作・自動スクショを行うための包括的なDocker設定を追加しました。WSL環境を含むすべての主要プラットフォーム（Windows/macOS/Linux）で動作します。

## 動機

- Dockerを使った統一的な開発環境の提供
- WSL環境での動作サポート
- 1コマンドでの簡単なセットアップ（`npm run dev3000:up`）
- セキュアなDocker設定（非root、権限制限、ヘルスチェック）

## 変更内容

### 新規追加ファイル

#### Docker設定
- **`docker/Dockerfile`**: Node.js 20 Bookworm Slim ベース、最小依存関係
- **`docker/docker-compose.yml`**: 単一コンテナ構成、WSL対応（host-gateway）
- **`docker/README.md`**: Docker設定の詳細ガイド
- **`.dockerignore`**: ビルドコンテキスト最適化

#### Next.js 15 サンプル
- **`example/nextjs15/package.json`**: Next.js 15依存関係定義
- **`example/nextjs15/pages/index.js`**: 最小サンプルページ
- **`example/nextjs15/next.config.js`**: Next.js設定

#### 自動化ツール
- **`tools/dev3000-up.mjs`**: Chrome起動 + Docker Compose起動（WSL/Linux/macOS/Windows対応）
- **`tools/dev3000-down.mjs`**: Docker Compose停止スクリプト

#### ドキュメント
- **`DOCKER_SETUP.md`**: 包括的なセットアップガイド（トラブルシューティング、アーキテクチャ図、開発ワークフロー）

### 既存ファイルの更新

- **`package.json`**: npm scripts追加（`dev3000:up`, `dev3000:down`）
- **`src/cdp-monitor.ts`**: 外部CDP接続のサポート（既存実装の確認）
  - `DEV3000_CDP=1`で外部Chrome接続
  - `DEV3000_CDP_URL`でCDP URL指定

## 主な機能

### 1. 単一コンテナアーキテクチャ
Dev3000が単一プロセスとしてNext.jsを子プロセス起動し、ログを統合します。

```
┌────────────────────────────────────┐
│ Host (WSL/Linux/macOS/Windows)    │
│  Chrome :9222 (CDP)               │
│       ↑                            │
│       │ CDP connection             │
│  ┌────┴─────────────────────┐     │
│  │ Docker Container         │     │
│  │  Dev3000 :3684           │     │
│  │    └─→ Next.js :3000     │     │
│  └──────────────────────────┘     │
└────────────────────────────────────┘
```text

### 2. WSL互換性
- `extra_hosts: host-gateway`でLinux/WSL環境でも`host.docker.internal`が使用可能
- Windows版Chromeを優先検索（Snap/Flatpak制約を回避）
- WSLパス対応: `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`

### 3. セキュリティ対策
- ✅ 非rootユーザー実行（`USER node`）
- ✅ 不要な権限削除（`cap_drop: ALL`）
- ✅ 新規特権取得の無効化（`no-new-privileges:true`）
- ✅ ヘルスチェック実装

### 4. ホットリロード対応
- `CHOKIDAR_USEPOLLING=true`
- `WATCHPACK_POLLING=true`
- ポーリングベースのファイル監視（WSL/Dockerボリューム対応）

## 使用方法

### クイックスタート
```bash
# リポジトリルートで実行
npm run dev3000:up
```

このコマンドで以下が自動実行されます：
1. Chrome起動（CDP有効、ポート9222）
2. Docker Composeでコンテナビルド・起動

### アクセスURL
- **Next.js**: <http://localhost:3000>
- **Dev3000 UI**: <http://localhost:3684>
- **ログ**: <http://localhost:3684/logs>

### 停止
```bash
npm run dev3000:down
```

## テスト方法

### 1. ビルドテスト
```bash
cd docker
docker compose build
```

### 2. 起動テスト
```bash
npm run dev3000:up
```

### 3. 動作確認
```bash
# ヘルスチェック
curl http://localhost:3684/health
curl http://localhost:3000

# ログ確認
docker compose logs dev3000 --tail=50
```

## 破壊的変更
なし（既存機能に影響なし）

## チェックリスト

- [x] Docker設定ファイルの作成
- [x] Next.js 15サンプルアプリの作成
- [x] 自動化ツールの作成（WSL対応）
- [x] 包括的なドキュメント作成
- [x] WSL互換性の確保
- [x] セキュリティ対策の実装
- [x] CDP外部接続のサポート確認
- [x] npm scriptsの追加

## 追加情報

### 対応プラットフォーム
- ✅ WSL (Ubuntu)
- ✅ Linux (Debian/Ubuntu/RHEL系)
- ✅ macOS (Intel/Apple Silicon)
- ✅ Windows (Docker Desktop)

### 既知の制限
- ⚠️ CDP（ポート9222）は無認証のため、開発環境専用
- ⚠️ Snap/Flatpak版ChromeはCDP制約の可能性（Windows版推奨）

### 関連ドキュメント
- `DOCKER_SETUP.md` - 詳細なセットアップガイド
- `docker/README.md` - Docker設定リファレンス

## スクリーンショット / デモ

（起動後にスクリーンショットを追加可能）

---

**注意**: このプルリクエストは開発環境向けの機能追加です。本番環境での使用は想定していません。

## レビューのポイント

1. Docker設定のセキュリティ（非root、権限制限）
2. WSL互換性（host-gateway、Chromeパス検索）
3. ドキュメントの充実度
4. 既存機能への影響なし

よろしくお願いします！

🤖 Generated with [Claude Code](https://claude.com/claude-code)
