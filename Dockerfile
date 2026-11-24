FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json server.js ./
COPY unity ./unity
COPY public ./public

RUN mkdir -p /app/storage

EXPOSE 3000

CMD ["node", "server.js"]
