# API của mini-app Nhân sự. Dữ liệu gốc (data/*.json) được đóng sẵn trong image để khớp với gói offline của bundle.
FROM node:24-alpine
WORKDIR /app
RUN npm install -g pnpm@12.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 4200
CMD ["pnpm", "start"]
