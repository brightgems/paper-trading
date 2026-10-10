# Deployment Guide

## Docker 部署（推荐）

### 一键启动

```bash
cd /git/paper-trading
docker compose up -d --build
```

服务启动后访问 `http://localhost:5001`，前端和 API 同在一个端口。

### 架构

- **多阶段构建**：Stage 1 构建前端 (Vite build → dist)，Stage 2 编译后端依赖 (better-sqlite3 native binding)，Stage 3 组装生产镜像
- **单容器**：Express 同时服务 API (`/api/*`) 和前端静态文件 (SPA fallback)
- **SQLite 持久化**：数据卷 `paper-trading-data` 挂载到 `/app/server/data`
- **信号文件**：宿主 `/git/quant_factors/results` 只读挂载到 `/data/signals`

### docker-compose.yml

```yaml
services:
  paper-trading:
    build: .
    container_name: paper-trading
    ports:
      - "5001:5001"
    volumes:
      - paper-trading-data:/app/server/data
      - /git/quant_factors/results:/data/signals:ro
    environment:
      - NODE_ENV=production
      - PORT=5001
    restart: unless-stopped

volumes:
  paper-trading-data:
```

### 常用命令

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f

# 重启
docker compose restart

# 停止
docker compose down

# 更新代码后重新部署
git pull && docker compose up -d --build
```

### 数据备份

SQLite 数据库在 Docker volume 中，备份方法：

```bash
# 导出
docker exec paper-trading sqlite3 /app/server/data/strategies.db ".backup /app/server/data/backup.db"
docker cp paper-trading:/app/server/data/backup.db ./backup.db

# 恢复
docker cp ./backup.db paper-trading:/app/server/data/strategies.db
docker compose restart
```

---

## 本地开发

### 后端

```bash
cd server
npm install
npm run dev      # nodemon, port 5001
```

### 前端

```bash
cd client
npm install
npm run dev      # Vite dev server, port 5173, proxy /api → 5001
```

### MCP Server

```bash
cd mcp
npm install
node index.js    # stdio MCP server
```

### 测试

```bash
cd server
node --test tests/api.test.js
```

---

## PM2 部署（替代方案）

如果不使用 Docker：

```bash
# 1. 构建前端
cd client && npm ci && npm run build

# 2. 安装后端依赖
cd ../server && npm ci

# 3. PM2 启动
pm2 start index.js --name paper-trading
pm2 save
pm2 startup    # 开机自启
```

注意：PM2 模式下需要手动构建前端，且 better-sqlite3 需要与本机 Node 版本匹配的编译环境。
