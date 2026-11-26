FROM node:26-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates bzip2 tar \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.23.0
WORKDIR /eval
COPY package.json ./
RUN pnpm install
COPY run.ts ./
ENTRYPOINT ["node", "run.ts"]
CMD ["public"]
