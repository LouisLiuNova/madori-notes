# 接口与部署

## 配置与运行

1. 创建独立的 Supabase PostgreSQL 环境并审核 `migrations/001_initial.sql`。使用直接连接或会话池运行迁移，迁移账户应有建表权限。
2. 在 Vercel 导入 GitHub 仓库并选择 Vite。分别为 Preview 和 Production 配置自己的 `DATABASE_URL`、`RECOVERY_CODE_SECRET`、`CRON_SECRET` 与 HTTPS `APP_ORIGIN`。服务端适合使用 Supavisor 事务池及 TLS，应用连接已关闭预处理。恢复摘要密钥至少 32 个字符，应保持稳定。[Supabase 连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. 访问 `/api/health` 检查数据库已应用迁移，并通过浏览器验证创建档案、恢复和并发草稿。发布前在预览环境运行接口与跨设备验收。正式地址、资源用量和真实日切在部署后记录。

本地可把上述变量放在被 Git 忽略的 `.env.local`，将 `APP_ORIGIN` 设为 Vite 的实际 HTTP 来源，启动开发服务。Vite 开发中间件与 Vercel 函数调用同一个 HTTP 处理器。

## 接口契约

[OpenAPI 3.1](openapi.json) 从 `server/contract.ts` 生成，并引用 [题面 Schema](level.schema.json) 与 [图纸 Schema](board.schema.json)。`bun run contracts` 更新产物。

- `GET /api/health` 返回健康状态和云配置状态。
- `POST /api/profile/{create,restore,rotate,logout}` 管理用户名、恢复码和会话。
- `GET /api/progress` 读取本人档案和草稿。 `PUT /api/progress` 校验档案和 `baseRevision`。并发时返回 `409 REVISION_CONFLICT`，客户端让用户选择保留的草稿。
- `GET /api/daily` 读取 UTC+8 当日题面，也可提供日期。 `POST /api/daily/solution` 返回参考图。 `POST /api/daily/complete` 复验提交，登录时可保存首次完成。
- `GET /api/cron/daily` 使用 Bearer 调度密钥补足当日起七天库存。缺题按日期事务锁补建，已发布日期保留原题面与版本。

私有响应采用 `no-store`。修改请求校验 Origin。正式会话 Cookie 使用 HttpOnly、Secure 和 SameSite=Lax。恢复码明文只在创建或轮换时返回一次。离线编辑在本机落盘，联网后重试，完成时立即尝试同步。

## 运维

- 使用 PostgreSQL 备份功能备份五张业务表。先在独立数据库测试恢复，核对档案数量、日题日期唯一性及 `/api/health`。
- 生成报告保留 30 天。检查 `generation_reports.elapsed_ms`、日题库存、Vercel 函数错误和 CPU、Supabase 数据库及传输用量。局部失败按具体日期补建，再检查是否已有发布结果。
- 回退应用时保留当前数据库，确认目标版本认识已发布的规则和目录。需要数据库结构回退时先备份并在预览验证兼容性。
- 本地 API 集成检查使用 `MADORI_API_TEST_URL` 与隔离服务的 `CRON_SECRET`。云端浏览器验收设置 `MADORI_WEB_URL` 与 `MADORI_CLOUD_BROWSER=1` 后运行 `bun --bun run test:e2e cloud.spec.ts`。生产预览离线检查使用 `MADORI_PREVIEW_BROWSER=1` 和预览 URL 运行 `offline.spec.ts`。
