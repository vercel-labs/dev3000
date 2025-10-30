# scripts ディレクトリの説明（Makefile 連携）

このディレクトリには、開発環境の起動や診断を補助するユーティリティスクリプトがまとまっています。通常、これらは直接実行するのではなく、Makefile のターゲットを通じて呼び出します（例: `make dev-up`, `make cdp-check`）。

注: ディレクトリ名は `scripts/` です（`script/` ではありません）。

## 目次
- 主要スクリプト概要（Makefile から呼び出されるもの）
- Make ターゲットとの対応表
- よくある質問 / トラブルシュート

---

## 主要スクリプト概要

### launch-chrome-cdp.js
- 目的: Chrome をリモートデバッグ（CDP: Chrome DevTools Protocol）有効で起動し、`dev3000` からブラウザに接続できる状態を作ります。
- 呼び出し元: `make dev-up`, `make start-chrome-cdp`（内部で `start-chrome-cdp-xplat` を経由）
- 主な機能:
  - OS/環境ごとの起動方法を吸収（Windows / WSL / macOS / Linux で動作）
  - 既に CDP が起動していれば検出してスキップ
  - 必要に応じて Chrome のインストールを案内（Windows は `winget`/`choco`、macOS は `brew cask`、Linux は各種パッケージマネージャ）
  - 起動時に `--remote-debugging-port=<port>` と一時プロフィール（`--user-data-dir`）を付与
  - WSL では Windows 側の Chrome を `powershell.exe` / `cmd.exe` 経由で起動（`--remote-debugging-address=0.0.0.0` を付与して到達性を改善）
- 主な引数（Makefile から付与されます）:
  - `--app-url <url>`: 起動後に開く URL（例: `http://localhost:3000/`）
  - `--check-url <url>`: CDP の疎通確認に使うエンドポイント（既定: `http://localhost:9222/json/version`）
  - `--cdp-port <port>`: リモートデバッグのポート番号（既定: `9222`）
- 便利な環境変数:
  - `LAUNCH_CHROME_AUTO_INSTALL=1` を設定すると、プロンプトなしで自動インストールを許可します（CI/非対話環境向け）。
- 直接実行例（参考）:
  - `node scripts/launch-chrome-cdp.js --app-url http://localhost:3000/ --check-url http://localhost:9222/json/version --cdp-port 9222`

### check-cdp.mjs
- 目的: CDP の到達性を多面的に診断し、どこで疎通が止まっているかを可視化します。
- 呼び出し元: `make cdp-check`
- 主な機能:
  - ホスト（WSL/Linux）からの `curl` で `http://localhost:9222/json/version` を確認
  - WSL 環境では Windows 側の `curl.exe` や PowerShell (`Invoke-WebRequest`) でも疎通チェック
  - Docker コンテナ内（`dev3000`）から `localhost:9222` と `host.docker.internal:9222` の両経路を確認
  - 取得できた JSON からブラウザバージョンを抽出表示
  - 最後にサマリとヒント（WSL/Windows でのよくある事象と対策）を表示
- 便利な環境変数:
  - `CDP_URL` を指定すると、既定 (`http://localhost:9222/json/version`) の代わりにその URL を診断に使います。
- 直接実行例（参考）:
  - `node scripts/check-cdp.mjs`
  - `CDP_URL=http://host.docker.internal:9222/json/version node scripts/check-cdp.mjs`

### docker-entrypoint.sh
- 目的: Docker コンテナ（`dev3000` 開発用）のエントリポイント。依存関係の初期化と CDP ルーティングの準備を行い、`dev3000` CLI を起動します。
- 呼び出し元: Docker コンテナ内（`docker-compose.yml` から利用）。Makefile の `deploy-frontend` ではこのスクリプトを `frontend/.dev3000/scripts/` にコピーします。
- 主な機能:
  - `frontend` の権限調整（WSL2 のボリューム対策）と `pnpm install`（初回だけ）
  - 残存した `npx` キャッシュの掃除（ノイズ警告抑制）
  - ホットリロード用のマウント状態を表示
  - CDP 接続設定：
    - `DEV3000_CDP_PROXY=socat` の場合、`localhost:9222`（コンテナ内）→ ホスト側 `9222` へプロキシ
    - 直接接続モードでは `DEV3000_CDP_URL` をそのまま使用
  - 最終的に `DEV3000_CDP_URL` を環境変数でエクスポートし、`dev3000` CLI を起動
- 主な環境変数:
  - `DEV3000_CDP_PROXY`: `socat` を指定するとプロキシ有効（未指定時は直接接続）
  - `DEV3000_CDP_HOST`: プロキシ先ホスト（省略時は `host.docker.internal` やゲートウェイを自動検出）
  - `DEV3000_CDP_PORT`: プロキシ先ポート（既定: `9222`）
  - `DEV3000_CDP_URL`: 直接接続モードで使用する CDP URL

同梱ポリシー (Bundling Policy)
- npm 配布物には `scripts/`（この README を含む）は同梱しません（`package.json` の `files` を参照）。
- npm に同梱されるのは `dist/`（CLI）と `mcp-server/.next`（ビルド成果物）など、実行に必要なランタイム一式です。
- Docker 周辺や reference テンプレートは Git リポジトリに同梱し、ユーザーは `.dev3000/example/.../reference/` からコピーして利用します。

---

## Make ターゲットとの対応表

- `make dev-up`
  - Docker を起動 → Next.js の起動待ち → `scripts/launch-chrome-cdp.js` で Chrome を CDP 有効で起動 → 接続確認
- `make start-chrome-cdp` / `make start-chrome-cdp-xplat`
  - 直接 `scripts/launch-chrome-cdp.js` を呼び出してブラウザを起動
- `make cdp-check`
  - `scripts/check-cdp.mjs` を実行して到達性を診断
- `make deploy-frontend`
  - `scripts/docker-entrypoint.sh` を `frontend/.dev3000/scripts/` にコピー（コンテナ実行時に使用）

基本方針: 日常作業では Make ターゲットを使い、スクリプトは個別に実行しないのが安全です（引数や環境変数の前提が Makefile 側で整えられるため）。

---

## よくある質問 / トラブルシュート

- Q. `dev-up` 後にブラウザが開かない / CDP に繋がらない
  - A. `make cdp-check` で診断してください。WSL 環境では Windows 側にのみバインドされるケースがあります。その場合の対策として、`launch-chrome-cdp.js` は WSL で `--remote-debugging-address=0.0.0.0` を付与して起動します。FW/ポート開放や社内ポリシーでブロックされていないかもご確認ください。

- Q. Chrome がインストールされていない
  - A. スクリプトがインストール手順を案内します。対話なしで自動許可したい場合は、`LAUNCH_CHROME_AUTO_INSTALL=1` をセットして実行してください。

- Q. ポート `9222` が既に使われている
  - A. 既存の CDP プロセスがあるか、別のアプリが使用している可能性があります。該当プロセスを終了するか、`--cdp-port` の値を変更して再実行してください（Makefile の該当箇所を書き換えるか、直接実行時に引数で指定）。

- Q. Docker コンテナからホスト側の CDP に届かない
  - A. `DEV3000_CDP_PROXY=socat` を使うと、コンテナ内 `localhost:9222` → ホスト `9222` へのプロキシ経路が張られます。WSL/ネットワーク環境で直接疎通しづらい場合に有効です。

---

## 変更ポリシー（開発者向け）

- スクリプトはできる限り Makefile 経由で使えるようにし、引数や環境変数のデフォルトは Makefile に寄せます。
- 直接実行する場合は、README の「直接実行例」に倣って安全に試せるようにしてください。
- 破壊的変更（引数名の変更・既定値の変更など）は、Makefile 側の連動修正と合わせて PR に明記してください。
