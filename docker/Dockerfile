FROM node:20-bookworm-slim

# ヘルスチェック用途のみ（ブラウザはホスト側CDPで制御）
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
USER node
