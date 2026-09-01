# Arbitrage Scanner（套利扫描器）

**只读、市场中性套利研究平台。** 第一阶段（Phase 1）持续扫描多个交易所与预测市场，检测可执行的套利机会，并在计入真实成本（手续费、滑点、延迟、链上 Gas、库存）后进行评估，最终在实时仪表盘中可视化展示 —— **不进行任何真金白银的交易**。

> ⚠️ **第一阶段为只读模式。** 本项目绝不挂真实订单、绝不索取或存储私钥、绝不使用需要认证的交易接口。所有实盘扫描与模拟仅用于研究。

---

## 功能特性

- **7 个交易所适配器**，统一规范化数据类型并支持订单簿重建：Binance、Bybit、Hyperliquid、Jupiter、Raydium、Polymarket。
- **6 大套利策略（S1–S6）**，每个策略均为纯计算函数并配有单元测试。
- **按可执行价格定价** —— 机会基于目标数量对应的真实订单簿深度定价，而非盘口最优报价或最新成交价。
- **成本感知的影子模拟（shadow simulation）** —— 含 Solana Gas、CEX/DEX 独立失败概率、预置库存、延迟与价格漂移四类模型。
- **实时仪表盘** —— Vue 3 + Element Plus + ECharts；扫描器将机会推送至 API，经 WebSocket 实时广播到前端。
- **质量门禁** —— 严格 TypeScript，`pnpm lint` / `typecheck` / `test` 必须全部通过。

## 仪表盘

研究仪表盘以只读、实时方式展示检测到的机会、模拟盈亏、净优势排行与资本配置。扫描器将机会推送至 API，经 WebSocket 实时广播，界面随之实时更新。

![概览](./docs/assets/dashboard-1.png)
*概览 —— 研究指挥中心：机会数量、模拟利润、最佳机会、净优势排行与资本配置。*

![机会列表](./docs/assets/dashboard-2.png)
*机会列表 —— 跨全部策略（S1–S6）的可执行两腿组合，可按资产、交易所、策略与最小净优势筛选。*

## 支持的交易所

| 类型 | 交易所 |
|------|--------|
| CEX 现货 | Binance、Bybit |
| 永续合约 | Binance Futures、Bybit Linear、Hyperliquid |
| Solana DEX | Jupiter、Raydium |
| 预测市场 | Polymarket |

## 策略一览

| 编号 | 策略 | 扫描器 | 状态 |
|------|------|--------|------|
| S1 | 现货/永续基差 | `scan:cex` / `scan:basis` | ✅ 已实现 |
| S2 | 永续/永续资金费率套利 | `scan:cex` / `scan:funding` | ✅ 已实现 |
| S3 | CEX/CEX 现货套利 | `scan:cex` | ✅ 已实现 |
| S4 | CEX/DEX 套利 | `scan:cex-dex` | ✅ 已实现 |
| S5 | DEX/DEX 套利 | `scan:dex-dex` | ✅ 已实现 |
| S6 | Polymarket 二元套利 | `scan:polymarket` | ✅ 已实现 |

S1–S5 由通用套利图引擎（arbitrage-graph）统一处理：从订单簿或路由曲线构建图节点，依据节点属性自动识别策略类型；S6 为二元完全组合（complete-set）引擎。

## 项目架构

基于 pnpm monorepo，各应用可独立构建，共享包被复用。依赖方向指向内部稳定领域契约：**交易所适配器不得包含策略逻辑，策略模块只消费规范化市场数据**。

```text
apps/
  collector/    公开行情数据采集 worker
  scanner/      策略评估与机会生成 worker
  simulator/    成交、费用、延迟、滑点模拟
  api/          Fastify 只读 API + WebSocket 实时推送 + 模拟数据源
  dashboard/    Vue 3 研究仪表盘（7 个页面）

packages/
  core/         规范化领域类型与通用基础能力
  venues/       7 个交易所适配器（规范化类型 + 订单簿重建）
  strategies/   策略契约与纯机会计算函数
  risk/         机会校验 + 4 个影子模拟成本模型
  execution/    第一阶段只读执行边界
  database/     PostgreSQL 连接、表结构与迁移
```

```mermaid
flowchart LR
    subgraph 交易所
        BIN[Binance] --> V[venues 适配器]
        BYB[Bybit] --> V
        HYP[Hyperliquid] --> V
        JUP[Jupiter] --> V
        RAY[Raydium] --> V
        POL[Polymarket] --> V
    end
    V --> CORE[(规范化市场数据)]
    CORE --> SCAN[scanner / strategies]
    SCAN --> RISK[risk 风控策略]
    RISK --> PUSH[推送 /api/opportunities]
    PUSH --> API[api + WebSocket /ws]
    API --> DASH[dashboard 仪表盘]
    SCAN --> SIM[simulator 模拟器]
    SIM --> DB[(PostgreSQL)]
    API --> DB
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 22、TypeScript（严格模式） |
| 包管理 | pnpm workspace |
| 数据存储 | PostgreSQL、Redis |
| 消息队列 | BullMQ |
| HTTP / WebSocket | Fastify |
| 前端 | Vue 3、Element Plus、ECharts |
| 交付 | Docker Compose |

---

## 快速开始（本地开发）

### 前置条件

- Node.js 22+
- pnpm（`corepack enable` 或 `npm i -g pnpm@10`）
- PostgreSQL 15+（*可选 —— 模拟模式下无需数据库*）

### 1. 模拟模式（无需数据库、无需交易所访问）

```bash
pnpm install

# 启动 API（含模拟数据源，端口 3000）
pnpm api:dev

# 另开一个终端，启动仪表盘（端口 5173，自动代理到 API）
pnpm dashboard:dev
```

打开 http://localhost:5173。仪表盘通过 WebSocket 连接 API 并实时刷新（模拟数据每 3 秒更新一次）。

### 2. 运行真实扫描器

每个扫描器是独立进程，读取公开行情（CEX 公开数据无需 API key）：

```bash
# S1 + S2 + S3（CEX：Binance、Bybit、Hyperliquid）
pnpm scan:cex

# S4（CEX-DEX：Binance 现货 ↔ Jupiter）
pnpm scan:cex-dex

# S5（DEX-DEX：Jupiter ↔ Raydium）
pnpm scan:dex-dex

# S6（Polymarket 二元）
pnpm scan:polymarket

# 同时启动所有扫描器
pnpm --filter @arbitrage-scanner/scanner start:prod
```

检测到的机会会推送到 API（`POST /api/opportunities`），经 `/ws` 广播并在仪表盘中展示。将 `MOCK_FEED=0` 设置为仅展示真实扫描数据。

> **地区说明：** Binance 和 Bybit 会封锁部分地区的 IP（例如美国）。若你的服务器位于受限地区，对应行情源会失败 —— 请在受支持地区运行 CEX 扫描器，或仅保留不受地域限制的 DEX/Polymarket 扫描器（`dex-dex`、`polymarket`）。

### 3. 运行影子模拟

```bash
# 合成 30 天回放（无需数据库）
SYNTHETIC=1 pnpm --filter @arbitrage-scanner/simulator replay:synthetic

# 数据库回放（需要 PostgreSQL 中有历史数据）
DATABASE_URL=postgresql://user:pass@localhost:5432/arbitrage \
  pnpm --filter @arbitrage-scanner/simulator replay
```

报告输出到 `apps/simulator/reports/`。

---

## 生产部署（Docker 一键部署）

生产栈运行在一台装有 Docker Engine + Compose v2 的 Ubuntu 服务器上。全部 6 个服务由 `docker-compose.prod.yml` 统一管理；`api` 容器只对外发布**一个宿主机端口**（默认 **8080**），同时承载仪表盘 SPA、REST API 与 WebSocket。你自己的 Nginx（域名 + TLS 由运维方管理）反代到该端口。

```
互联网 → Nginx（crypto.yourdomain.com，TLS）→ 127.0.0.1:8080（api 容器）
                                                    ├── 仪表盘 SPA（/）
                                                    ├── REST API（/api）
                                                    └── WebSocket（/ws）
```

### 1. 服务器前置

- 域名 DNS A/AAAA 记录指向服务器，放行入站 TCP 80/443。
- 安装 Docker Engine 及 Compose 插件。
- *（可选）* 宿主机上已有的 Redis 不会被触碰 —— compose 内置 Redis 默认发布 **6380** 端口，避开 6379。

### 2. 配置环境变量

```bash
cp .env.prod.example .env.prod
$EDITOR .env.prod
```

至少设置一个强随机的 `POSTGRES_PASSWORD`（如使用 DEX 扫描器，还需 `SOLANA_RPC_API_KEY` / `JUPITER_API_KEY`）。**切勿提交 `.env.prod`。** 第一阶段无需任何交易所私钥。

### 3. 一键部署

```bash
./scripts/deploy.sh
```

脚本会构建应用镜像（API 镜像内含仪表盘构建产物）、启动 PostgreSQL 与 Redis、执行数据库迁移，然后启动并等待全部 6 个服务就绪。

### 4. Nginx 反向代理（单端口）

将 Nginx 指向 `http://127.0.0.1:8080`。仪表盘会自动从 `location.host` 推导 WebSocket 地址，无需硬编码 WS URL。最小配置示例：

```nginx
server {
    listen 80;
    server_name crypto.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 升级（仪表盘实时更新必需）
    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

按常规方式加上 TLS 证书（`listen 443 ssl; ...`）即可 —— API 已信任 `X-Forwarded-*` 头。

### 5. 日常运维

```bash
# 查看全部 6 个服务的健康状态
./scripts/healthcheck.sh

# 备份 PostgreSQL + Redis（带时间戳目录 + SHA-256 校验）
./scripts/backup.sh

# 无需 git 也能更新到最新构建
./scripts/update.sh

# 跟随查看日志
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200
```

| 宿主机端口 | 服务 | 说明 |
|-----------|------|------|
| 8080 | api | 仪表盘 SPA + REST + WebSocket |
| 6380 | redis | compose 内置；避开宿主机已有的 6379 |
| （不映射） | postgres | 默认仅内网访问；如需宿主机访问可设 `POSTGRES_PUBLISH_PORT` |

> 本项目**必须使用 PostgreSQL**（依赖 JSONB、自增标识列、咨询锁等特性）—— 已有的 MySQL 无法替代；compose 会启动自己的 `postgres` 容器。

---

## 关键环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `API_PUBLISH_PORT` | `8080` | api 容器发布的宿主机端口 |
| `MOCK_FEED` | `1`（开发）/ `0`（生产） | 设为 `0` 禁用模拟数据，仅展示真实扫描数据 |
| `POSTGRES_PASSWORD` | — | PostgreSQL 密码（务必设置强随机值） |
| `POSTGRES_PUBLISH_PORT` | （空） | 可选的 PostgreSQL 宿主机端口 |
| `REDIS_PUBLISH_PORT` | `6380` | compose 内置 Redis 的宿主机端口 |
| `JUPITER_API_KEY` | （无） | Jupiter API key，用于提高限流额度 |
| `SOLANA_RPC_URL` / `SOLANA_RPC_API_KEY` | （无） | Helius Solana RPC，用于链上状态采集 |
| `VITE_WS_URL` | （自动） | 覆盖仪表盘 WebSocket 地址（通常留空） |
| `API_URL` | `http://localhost:3000` | 扫描器 → API 推送目标（Docker 内为 `http://api:3000`） |

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
```

所有改动必须通过以上三项。策略模块需覆盖盈利、亏损、深度不足、数据过期、手续费、取整等场景的单元测试。

## 文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 完整架构、依赖规则、实现状态
- [DEPLOYMENT.md](./DEPLOYMENT.md) — 本地开发与生产部署细节
- [SHADOW_SIMULATION.md](./SHADOW_SIMULATION.md) — 30 天影子模拟指南

## 安全说明

第一阶段**只读**。不进行真实交易、不涉及私钥、不使用认证交易接口。密钥只存在于环境变量中且绝不写入日志。只有当 30 天影子模拟在计入真实成本后仍能证明稳定正期望收益，才考虑进入真实交易阶段。
