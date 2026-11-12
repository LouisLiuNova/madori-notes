# MVP 设计与验收

## 轮廓与生成

- 24 关按四章推进，教学图纸使用缺角、退台、凹口等轮廓。建筑之外的格子没有面积、编辑命中或通行节点。沿凹口的外轮廓按外墙规则检查门窗。
- 日题生成器 v3 按 UTC+8 公历日轮换七种轮廓族。候选种子改变切口深度或位置、分区边界、门洞和家具布局。连续七天覆盖七个轮廓族，题面仍可以有多解。
- 面积余量以真实可用面积计算。入门、标准、进阶分别要求至少 4、3、2 份合法见证。签名忽略家具实例 ID，固定主入口在图纸边缘的非对称位置约束了整图旋转与镜像。每份见证调用与玩家提交相同的判定器。
- 单题最多尝试 20 个候选，每个候选最多 200 次布局变化。候选用尽后尝试已定义的备用种子，备用也必须通过同一质量筛选。生成器 v1、v2 可继续读取原日期的存档。

## 图纸表达

工作纸、房间色块、墨线和底部构件托盘参考《图纸没问题》Demo 的公开画面，平面图和组件使用项目自身的 SVG 与 CSS。[原作页面](https://store.steampowered.com/app/5429370/Looks_Fine_on_Paper/) · [Demo 画面](https://steamwatch.info/game/5440040)

参照现行房屋建筑和建筑专业制图标准，采用定位轴号、尺寸界线、斜短划、分尺寸与总尺寸、北向、墙体线宽层次、推门开启弧、窗的双细线、拉门与栏杆符号。游戏内一格对应 1000 mm 的图示模数，委托条件、家具占地和可达判定按格子计算。[GB/T 50001-2017](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=102879) · [GB/T 50104-2010](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=57783)

奉书采用浅色工作纸和低饱和色块，若竹、藤霞、工业蓝图、原色构成共享图纸几何与命中逻辑。StyleKit 参照 Sketch Style、Japanese Fresh、Blueprint 和 Bauhaus，动态类和 SVG 结合浏览器渲染检查。主要交互遵循 44 像素触控、可见焦点和文字状态。界面层级及交互参考 [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[Primer](https://primer.style/)、[Radix Themes](https://www.radix-ui.com/themes/docs/theme/overview) 与 [Ant Design 布局](https://ant.design/docs/spec/layout/)。

## 验收入口

- `tests/domain.test.ts` 覆盖每关的两份布局和不完整草稿，以及房间、动线、家具、视线、Wi-Fi、历史日题和轮廓分布。压力种子为 `mvp-check-0` 至 `mvp-check-999`，覆盖 8 至 16 格、全部难度及七种轮廓族。
- `tests/e2e` 使用 Chromium 检查绘制、门、家具、键盘与焦点、主题、触屏、日题和存档。云档案与离线刷新使用各自的环境开关。
- `tests/api.test.ts` 在独立 PostgreSQL 实例验收日题按日期幂等、首次完成、版本冲突、恢复码轮换和私有缓存。正式环境验证见部署说明。
