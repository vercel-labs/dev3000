# dev3000 MCP Setup

このガイドでは、ローカルで実行している dev3000 を Claude (Desktop/Code) の MCP サーバーとして接続する方法を説明します。

## 前提条件

- dev3000 が起動していること (`http://localhost:3684/mcp` でアクセス可能)
- **Chrome DevTools Protocol (CDP) が有効なブラウザが起動していること** (`http://localhost:9222` でアクセス可能)
  - dev3000 の MCP ツール（`execute_browser_action`, `fix_my_app` など）は CDP を使用してブラウザを操作します
  - CDP ブラウザが起動していない場合、MCP ツールは正常に動作しません
  - `make dev-up` を実行すると自動的に CDP 対応 Chrome が起動します
- Node.js 18+ がインストールされていること
- Claude Desktop または Claude Code (CLI) がインストールされていること

## 目次

- [Claude Code (CLI) でのセットアップ](#claude-code-cli-でのセットアップ) ⭐ **おすすめ**
- [Claude Desktop でのセットアップ](#claude-desktop-でのセットアップ)
- [利用可能な MCP ツール](#利用可能な-mcp-ツール)
- [トラブルシューティング](#トラブルシューティング)

---

## Claude Code (CLI) でのセットアップ

### 1. dev3000 を起動

まず、dev3000 を起動します：

```bash
# Docker環境の場合
make dev-up

# またはローカル環境の場合
dev3000
# または
d3k
```

dev3000 が起動すると、以下にアクセス可能になります：
- MCP サーバー: `http://localhost:3684/mcp`
- Web UI: `http://localhost:3684`
- ログビューア: `http://localhost:3684/logs`

### 2. プロジェクトの MCP 設定を有効化

このリポジトリには既に `.claude/mcp.json` が設定されているので、プロジェクト MCP を有効化するだけです。

現在のセッションで以下を実行：

```bash
# .claude/settings.local.json を確認
cat .claude/settings.local.json
```

`enableAllProjectMcpServers` が `true` になっていることを確認してください。

```json
{
  "enableAllProjectMcpServers": true
}
```

### 3. Claude Code を再起動

Claude Code を再起動して、MCP 設定を読み込みます：

1. 現在の Claude Code セッションを終了 (`Ctrl+C` または `exit`)
2. 新しいセッションを開始：
   ```bash
   claude
   ```

### 4. 動作確認

Claude Code で以下を試してください：

```
dev3000 の MCP ツールが使えますか？
```

または

```
fix my app
```

成功すると、dev3000 の MCP ツールにアクセスできるようになります！

---

## Claude Desktop でのセットアップ

### 1. dev3000 を起動

まず、dev3000 を起動します：

```bash
# Docker環境の場合
make dev-up

# またはローカル環境の場合
dev3000
# または
d3k
```

dev3000 が起動すると、以下にアクセス可能になります：
- MCP サーバー: `http://localhost:3684/mcp`
- Web UI: `http://localhost:3684`
- ログビューア: `http://localhost:3684/logs`

### 2. Claude Desktop 設定ファイルを編集

Claude Desktop の設定ファイルを開きます：

**macOS**:
```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows**:
```powershell
code %APPDATA%\Claude\claude_desktop_config.json
```

**Linux**:
```bash
code ~/.config/Claude/claude_desktop_config.json
```

### 3. MCP サーバー設定を追加

設定ファイルに以下を追加します：

```json
{
  "mcpServers": {
    "dev3000": {
      "command": "node",
      "args": [
        "/mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js"
      ],
      "env": {}
    }
  }
}
```

**重要**: `args` の中のパスは、**このリポジトリの絶対パス**に置き換えてください。

#### パスの確認方法

リポジトリのルートディレクトリで以下を実行：

```bash
pwd
# 出力例: /mnt/d/github/dev3000
```

出力されたパスを使って、設定を更新します：

```json
{
  "mcpServers": {
    "dev3000": {
      "command": "node",
      "args": [
        "<PWD の出力>/scripts/mcp-stdio-bridge.js"
      ],
      "env": {}
    }
  }
}
```

### 4. カスタムポートを使用する場合

dev3000 を別のポートで起動している場合は、以下のように設定します：

```json
{
  "mcpServers": {
    "dev3000": {
      "command": "node",
      "args": [
        "/mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js",
        "--port",
        "3685"
      ],
      "env": {}
    }
  }
}
```

### 5. Claude Desktop を再起動

設定ファイルを保存したら、Claude Desktop を完全に再起動します：

1. Claude Desktop を終了
2. Claude Desktop を再起動
3. 新しい会話を開始

### 6. 動作確認

Claude Desktop で以下のように試してください：

```
dev3000の利用可能なツールを教えてください
```

または

```
fix my app
```

成功すると、Claude が dev3000 の MCP ツールにアクセスできるようになります。

## 利用可能な MCP ツール

dev3000 は以下のツールを提供します：

### 🔧 デバッグツール

- **`fix_my_app`** - AI駆動のアプリデバッグ・修正ツール
  - ログ分析、エラー検出、修正提案
  - Next.js/Chrome DevTools MCP との統合サポート
  - タイムスタンプベースのデバッグワークフロー

- **`fix_my_jank`** - パフォーマンス・レイアウトシフト専用ツール
  - CLS（Cumulative Layout Shift）検出
  - パフォーマンス問題の特定と修正

### 🌐 ブラウザ操作

- **`execute_browser_action`** - ブラウザ自動化
  - クリック、ナビゲーション、スクリーンショット
  - JavaScript評価、スクロール、テキスト入力

- **`crawl_app`** - アプリケーションクローラー
  - リンクを辿ってページを自動巡回
  - 全ページのスクリーンショット取得

### 🔍 解析ツール

- **`analyze_visual_diff`** - ビジュアル差分解析
  - 2つのスクリーンショットを比較
  - レイアウトシフトの原因特定

- **`find_component_source`** - コンポーネントソース検索
  - CSSセレクタからソースコードを特定
  - DOM要素とコードの関連付け

### 🔄 サーバー管理

- **`restart_dev_server`** - 開発サーバー再起動
  - ビルドキャッシュクリア
  - サーバープロセス再起動

## トラブルシューティング

### MCP サーバーに接続できない

1. dev3000 が起動していることを確認：
   ```bash
   curl http://localhost:3684/
   ```

2. ブリッジスクリプトが正しく動作するか確認：
   ```bash
   node /mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js
   # Ctrl+C で終了
   ```

3. Claude Desktop のログを確認：
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%\Claude\logs\`
   - Linux: `~/.config/Claude/logs/`

### CDP ブラウザが起動していない

**重要**: dev3000 の MCP ツールは Chrome DevTools Protocol (CDP) を使用するため、CDP が有効なブラウザが起動している必要があります。

1. CDP ブラウザが起動しているか確認：
   ```bash
   curl http://localhost:9222/json/version
   ```

2. CDP ブラウザが起動していない場合、以下のコマンドで起動：
   ```bash
   make start-chrome-cdp
   ```

   または手動で起動：

   **WSL2/Windows:**
   ```powershell
   chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\temp\chrome-dev-profile http://localhost:3000
   ```

   **macOS:**
   ```bash
   open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
   ```

   **Linux:**
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
   ```

3. CDP ブラウザが起動していない場合の症状：
   - `execute_browser_action` ツールがエラーを返す
   - `fix_my_app` でブラウザ関連のエラーが検出できない
   - スクリーンショットが取得できない

### ポート 3684 が使用中

別のポートで dev3000 を起動している場合：

```bash
# 起動時にポートを指定
dev3000 --mcp-port 3685
```

そして Claude Desktop 設定で `--port 3685` を追加します。

### パスが見つからない

**絶対パス**を使用していることを確認してください。相対パスは動作しません：

```json
// ❌ NG
"args": ["./scripts/mcp-stdio-bridge.js"]

// ✅ OK
"args": ["/mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js"]
```

## 高度な設定

### 複数の MCP サーバーを使用

dev3000 と他の MCP サーバーを同時に使用できます：

```json
{
  "mcpServers": {
    "dev3000": {
      "command": "node",
      "args": ["/mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/files"]
    }
  }
}
```

### 環境変数の設定

```json
{
  "mcpServers": {
    "dev3000": {
      "command": "node",
      "args": ["/mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js"],
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "mcp:*"
      }
    }
  }
}
```

## 他のプロジェクトで dev3000 MCP を使用

このリポジトリ以外のプロジェクトで dev3000 MCP を使いたい場合：

### Claude Code の場合

プロジェクトのルートに `.claude/mcp.json` を作成：

```json
{
  "mcpServers": {
    "dev3000": {
      "command": "node",
      "args": [
        "/mnt/d/github/dev3000/scripts/mcp-stdio-bridge.js"
      ],
      "env": {}
    }
  }
}
```

**重要**: パスをこのリポジトリの絶対パスに置き換えてください。

そして `.claude/settings.local.json` を作成：

```json
{
  "enableAllProjectMcpServers": true
}
```

### Claude Desktop の場合

グローバル設定ファイル（上記参照）に dev3000 を追加すれば、すべてのプロジェクトで使用できます。

## 参考リンク

- [dev3000 公式ドキュメント](../README.md)
- [Model Context Protocol 仕様](https://modelcontextprotocol.io/)
- [Claude Desktop MCP 設定ガイド](https://docs.anthropic.com/claude/docs/mcp)
