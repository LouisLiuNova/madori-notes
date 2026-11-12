# 间取手帖

`madori-notes` 是受《图纸没问题》（*Looks Fine on Paper*）启发的非官方网页版建筑空间解谜项目。

## 本地开发

使用 Bun 安装依赖并运行开发命令。这里使用 `bun --bun run` 让工具链由 Bun 执行。

```bash
bun install --frozen-lockfile
bun --bun run dev
```

浏览器打开 Vite 输出的本地地址。当前页面是开发入口，游戏逻辑和云服务待实现。本地启动无需配置环境变量。

| 命令 | 用途 |
| --- | --- |
| `bun --bun run typecheck` | TypeScript 检查 |
| `bun --bun run lint` | 静态检查 |
| `bun --bun run test` | 运行 Vitest，当前尚无测试用例 |
| `bun --bun run build` | 生成 `dist/` 生产产物 |
| `bun --bun run preview` | 预览生产构建 |

## 项目目录

- `src/` 存放 React 入口、应用、组件、主题和 Worker。
- `packages/domain/` 和 `packages/generator/` 预留给共享规则与题目生成。
- `api/`、`server/` 和 `migrations/` 预留给 API、服务层和数据库迁移。
- `content/` 和 `tests/` 预留给关卡内容与集成测试。

设计交接资料保存在本地的 `.local/handoff/`，内有原 ZIP 和完整的解压目录。开发前可从解压目录里的 `README.md` 查阅阅读顺序。Git 忽略整个本地资料目录，新克隆需要另行取得交接包。
