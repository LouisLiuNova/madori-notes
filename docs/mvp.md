# MVP 设计与验收

## 轮廓与生成

- 24 关按四章推进，教学图纸使用缺角、退台、凹口等轮廓。建筑之外的格子没有面积、编辑命中或通行节点。沿凹口的外轮廓按外墙规则检查门窗。
- 日题生成器 v5 默认以 UTC+8 公历日期为种子，生成 8 至 12 格宽和高的图纸。种子决定走廊位置、侧翼数量和各翼的开间、进深与退台；部分图纸会沿客厅外墙生成阳台。整套轮廓和去掉阳台后的室内轮廓都必须在各自最小包围盒内留出至少一处 2×2 格的退台。
- 日题包含四至六种房间，起始只标记入户落脚格，固定窗与通行关系共同约束分区。进阶题再结合床的朝向或跨墙 Wi-Fi。相较于参考布局，入门、标准、进阶的每种房间分别留三、二、一格面积余量。
- 入门、标准、进阶分别要求至少四、三、两份合法见证。v4 和 v5 要求每份见证的房间分区不同，由玩家提交时使用的同一判定器复验。每个候选至多尝试 100 次，单题至多尝试 20 个候选，候选用尽后尝试备用种子。
- 日题 v1–v4 可按原日期和版本读取，已发布的日题沿用发布时的题面。
- 关卡契约的家具数量条件支持可选 `room` 字段，指定时只统计完整落在该类房间的合法家具。

## 图纸表达

工作纸、房间色块、墨线和底部构件托盘参考《图纸没问题》Demo 的公开画面，平面图和组件使用项目自身的 SVG 与 CSS。[原作页面](https://store.steampowered.com/app/5429370/Looks_Fine_on_Paper/) · [Demo 画面](https://steamwatch.info/game/5440040)

参照现行房屋建筑和建筑专业制图标准，采用定位轴号、尺寸界线、斜短划、分尺寸与总尺寸、北向、墙体线宽层次、推门开启弧、窗的双细线、拉门与栏杆符号。游戏内一格对应 1000 mm 的图示模数，委托条件、家具占地和可达判定按格子计算。[GB/T 50001-2017](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=102879) · [GB/T 50104-2010](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=57783)

奉书采用浅色工作纸和低饱和色块，若竹、藤霞、工业蓝图、原色构成共享图纸几何与命中逻辑。StyleKit 参照 Sketch Style、Japanese Fresh、Blueprint 和 Bauhaus，动态类和 SVG 结合浏览器渲染检查。主要交互遵循 44 像素触控、可见焦点和文字状态。界面层级及交互参考 [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[Primer](https://primer.style/)、[Radix Themes](https://www.radix-ui.com/themes/docs/theme/overview) 与 [Ant Design 布局](https://ant.design/docs/spec/layout/)。

## 验收入口

- `tests/domain.test.ts` 覆盖每关的两份布局和不完整草稿，以及房间、动线、家具、视线、Wi-Fi、历史日题、轮廓退台和同尺寸下的形状多样性。压力种子为 `mvp-check-0` 至 `mvp-check-999`，覆盖 8 至 16 格和全部难度。
- `tests/e2e` 使用 Chromium 检查绘制、门、家具、键盘与焦点、主题、触屏、日题和存档。云档案与离线刷新使用各自的环境开关。
- `tests/api.test.ts` 在独立 PostgreSQL 实例验收日题按日期幂等、首次完成、版本冲突、恢复码轮换和私有缓存。正式环境验证见部署说明。
