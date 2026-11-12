# 间取手帖

原创网页版建筑空间解谜。玩家在网格图纸上分配房间、调整边界和门窗、安放家具，满足委托后提交。包含 24 关教学、每日挑战、五套亮暗主题、本地草稿与可选云档案。

受《图纸没问题》启发，由个人出于兴趣与技术练习制作。欢迎在 Steam 了解并支持原作者。[原作商店](https://store.steampowered.com/app/5429370/Looks_Fine_on_Paper/)

## 本地运行

```sh
bun install --frozen-lockfile
bun --bun run dev --host 127.0.0.1
```

从 Vite 输出打开浏览器。无环境变量即可游玩。图纸下方可选房间、墙与开口和家具。矩形工具支持点按编辑单格、拖动编辑选区。键盘用方向键选格，Shift + 方向键选边，Enter 应用工具或选定矩形的角。

- 前端默认在 [127.0.0.1:5173](http://127.0.0.1:5173/)。
- [API 健康检查](http://127.0.0.1:5173/api/health) 返回当前云配置状态。
- 游客进度保存在 IndexedDB，可从「本地存档」导入或导出。
- 生产构建缓存前端和内置题面，可离线继续。首次在线打开页面后等待 Service Worker 接管。

## 检查

| 命令 | 用途 |
| --- | --- |
| `bun --bun run typecheck` | TypeScript 检查 |
| `bun --bun run lint` | 静态检查 |
| `bun --bun run test` | 领域规则、存档与 1,000 个种子的生成验证 |
| `bun --bun run build` | 生成 `dist/` 和离线资源 |
| `bun run contracts:check` | 核对 OpenAPI 和 JSON Schema |
| `bun --bun run test:e2e` | Chromium 交互回归，首次运行前安装浏览器 |

`content/` 保存关卡。前端、Worker、生成器和 API 共用 `packages/domain/`。API 契约、云配置和运维步骤见 [接口与部署](docs/deployment.md)，视觉与验证口径见 [MVP 说明](docs/mvp.md)。原始设计交接包由本地 `.local/handoff/` 管理。
