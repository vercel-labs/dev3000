# プッシュとプルリクエスト作成手順

## 1. リモートへのプッシュ

以下のコマンドでブランチをリモートにプッシュしてください：

```bash
cd /mnt/d/github/dev3000
git push -u origin docker-wsl-support
```

GitHubの認証が必要な場合は、以下のいずれかの方法を使用してください：

### 方法A: GitHub CLI（推奨）
```bash
gh auth login
git push -u origin docker-wsl-support
```

### 方法B: Personal Access Token
1. GitHub設定から Personal Access Token を作成
   - https://github.com/settings/tokens
   - `repo` スコープを選択
2. プッシュ時にトークンを入力

### 方法C: SSH（推奨）
```bash
# リモートURLをSSHに変更
git remote set-url origin git@github.com:automationjp/dev3000.git

# プッシュ
git push -u origin docker-wsl-support
```

## 2. プルリクエストの作成

### GitHub CLI使用（推奨）
```bash
gh pr create \
  --title "Add Docker and WSL support for Dev3000 + Next.js 15" \
  --body-file PR_TEMPLATE.md \
  --base main \
  --head docker-wsl-support
```

### GitHub Web UI使用
1. ブラウザで https://github.com/automationjp/dev3000 を開く
2. "Compare & pull request" ボタンをクリック
3. 以下の情報を入力：
   - **Title**: `Add Docker and WSL support for Dev3000 + Next.js 15`
   - **Body**: `PR_TEMPLATE.md` の内容をコピー&ペースト
   - **Base**: `main`
   - **Compare**: `docker-wsl-support`
4. "Create pull request" をクリック

## 3. アップストリームへの登録依頼

### vercel-labs/dev3000 へのプルリクエスト

```bash
# アップストリームへプッシュ（フォーク元のリポジトリにプルリクエストを作成する場合）
gh pr create \
  --repo vercel-labs/dev3000 \
  --title "Add Docker and WSL support for Dev3000 + Next.js 15" \
  --body-file PR_TEMPLATE.md \
  --base main \
  --head automationjp:docker-wsl-support
```

または、GitHub Web UIで：
1. https://github.com/vercel-labs/dev3000 を開く
2. "New pull request" をクリック
3. "compare across forks" をクリック
4. 以下を選択：
   - **Base repository**: `vercel-labs/dev3000`
   - **Base**: `main`
   - **Head repository**: `automationjp/dev3000`
   - **Compare**: `docker-wsl-support`
5. "Create pull request" をクリック
6. `PR_TEMPLATE.md` の内容を本文に貼り付け

## 変更内容サマリー

### 追加ファイル（10件）
```
.dockerignore
DOCKER_SETUP.md
docker/Dockerfile
docker/README.md
docker/docker-compose.yml
example/nextjs15/next.config.js
example/nextjs15/package.json
example/nextjs15/pages/index.js
tools/dev3000-down.mjs
tools/dev3000-up.mjs
```

### 変更ファイル（2件）
```
package.json         (+3行: npm scripts追加)
src/cdp-monitor.ts   (+25行: 外部CDP接続サポート)
```

### コミット（2件）
1. `7607fc1` - Add Docker and WSL support for Dev3000 + Next.js 15
2. `6e1689c` - Update CDP monitor and package.json for external Chrome support

## プルリクエスト説明のポイント

以下の点を強調してください：

### 主要機能
✅ Docker + WSL完全対応
✅ 1コマンド起動（`npm run dev3000:up`）
✅ ホストChrome（CDP）による自動操作
✅ セキュア設定（非root、権限制限）
✅ 包括的なドキュメント

### 対応プラットフォーム
✅ WSL (Ubuntu/Debian)
✅ Linux (all distros)
✅ macOS (Intel/Apple Silicon)
✅ Windows (Docker Desktop)

### 破壊的変更
❌ なし（既存機能に影響なし）

## レビュワーへの質問例

プルリクエストに以下の質問を追加すると良いでしょう：

1. Docker設定のセキュリティ対策は十分でしょうか？
2. WSL対応のChrome検索ロジックは適切でしょうか？
3. ドキュメントに追加すべき情報はありますか？
4. 他のプラットフォームでのテストは必要でしょうか？

## 次のステップ

1. ✅ ブランチをリモートにプッシュ
2. ⬜ プルリクエストを作成
3. ⬜ CIテストの結果を確認
4. ⬜ レビューに対応
5. ⬜ マージ承認待ち

---

**注意**: vercel-labs/dev3000 へのプルリクエストには、メンテナーのレビューと承認が必要です。
