# Live2D 多屏自由移动未完成实现交接记录

- 文档ID：DOC-CHANGELOG-LIVE2D-MMOVE-002
- 类型：ChangeLog
- 状态：Draft
- 当前版本：v1.2.0
- 创建日期：2026-03-24
- 更新日期：2026-03-24
- 作者：Codex / 项目维护组
- 评审人：待补充
- 关联需求：REQ-LIVE2D-MULTI-MONITOR-FREE-MOVE
- 关联任务：TASK-LIVE2D-MULTI-MONITOR-FREE-MOVE（待补充）
- 关联代码：Commit 4d97eab（方案设计基线） + 当前工作区未提交实现（2026-03-24）
- 关联发布：Release 待补充

## 1. 背景与目标

本记录用于承接 `2026-03-16` 提交的多屏自由移动设计方案，并盘点当前工作区中尚未提交的实现进度，避免在插入更高优先级需求后丢失上下文。

本文件关注两件事：

1. 当前已经编辑了哪些实现内容
2. 这些实现内容与设计文档相比已经落地到什么程度，还缺什么

设计基线见 [document/design/design-live2d-multi-monitor-free-move-20260316-v1.0.0.md](/d:/Github/my-neuro/document/design/design-live2d-multi-monitor-free-move-20260316-v1.0.0.md)。

## 2. 当前工作区状态

截至 `2026-03-24`，与该需求直接相关的工作区状态如下：

已修改且已被 Git 跟踪：

1. [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)
2. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)
3. [live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json)

已新增但尚未被 Git 跟踪：

1. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js)
2. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js)
3. [document/changelog/changelog-live2d-multi-monitor-free-move-20260316-v1.1.0.md](/d:/Github/my-neuro/document/changelog/changelog-live2d-multi-monitor-free-move-20260316-v1.1.0.md)

说明：

1. 最新已提交 commit 为 `4d97eab`，内容仅包含方案设计文档
2. 多屏自由移动的代码实现目前全部停留在工作区，尚未形成新的 Git 提交
3. `config.json` 当前变更更像一次运行后的样本数据，属于实现副产物，不等同于核心代码落地

## 3. 已实现内容盘点

### 3.1 主进程显示器服务层已落地

设计文档第 `7.1` 阶段要求的服务层抽离，已经有明确代码落地：

1. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js) 已实现显示器枚举、按 `id` 查找、窗口归属显示器判定、按方向筛选相邻显示器
2. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js) 已实现窗口 bounds 生成、启动显示器解析、显示器间迁移、模型位置持久化载荷组装

与设计对照：

1. `display-topology-service` 已覆盖“读取所有显示器”“按方向选相邻显示器”“按全局点定位显示器”
2. `window-placement-service` 已覆盖“按显示器创建窗口”“迁移窗口到目标显示器”“输出带显示器上下文的位置结构”
3. 设计里提到单独拆出 `cross-screen-drag-controller.js`，当前并未独立成文件，而是并入了渲染层交互控制器

### 3.2 主进程已接入多屏创建与迁移链路

[live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js) 已完成以下接入：

1. 创建窗口时不再固定使用主显示器，而是通过保存的位置解析初始显示器
2. `BrowserWindow` 的 `x/y/width/height` 改为使用目标显示器 `workArea`
3. `will-move` 边界判断改为基于当前窗口所在显示器，而非主显示器
4. `window-move` 的约束逻辑也已切换到当前显示器工作区
5. 新增 `transfer-model-to-display` IPC，供渲染层拖拽时请求跨屏迁移
6. `save-model-position` 已改为写入 `display_id`、`display_relative`、`desktop_global`、`display_snapshot`

这意味着设计里的“单窗口驻留单显示器，拖到边缘时由主进程迁移整窗”的主干方案已经实际编码。

### 3.3 渲染层已接入跨屏拖拽判定

[live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js) 已完成以下实现：

1. 为模型拖拽增加跨屏状态变量、防抖时间和边缘阈值
2. 增加 `getCanvasMetrics()`、`toWindowPixels()`，把 PIXI 坐标转换成窗口 CSS 像素坐标
3. 拖拽过程中在更新模型位置后调用 `maybeTransferAcrossDisplays()`
4. 在指针靠近窗口边缘时，根据方向触发 `transfer-model-to-display`
5. 收到主进程返回的新局部指针坐标后，重新设置模型位置并继续拖拽
6. 启动恢复位置时优先读取 `display_relative`，并兼容旧结构 `x/y`
7. 保存位置前执行可见区钳制，避免把明显越界的位置继续写回

这部分已经覆盖设计文档第 `7.2` 和 `7.3` 的主体内容。

### 3.4 位置持久化结构已经升级

[live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json) 当前样本显示，位置结构已从旧的：

1. `x`
2. `y`
3. `remember_position`

升级为：

1. `display_id`
2. `display_relative`
3. `desktop_global`
4. `display_snapshot`

同时，[live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js) 在内存中仍兼容写回旧字段 `x/y`，用于降低旧逻辑立刻失效的风险。

### 3.5 已加入针对三屏排障的日志与保护

从当前代码和既有未跟踪文档内容来看，开发过程中已经针对实机问题加入过两类修复：

1. 坐标系修复：避免直接把 PIXI 内部坐标当成窗口像素坐标使用
2. 可见区保护：恢复位置、跨屏后、保存前都增加模型位置钳制

对应日志统一使用 `[multi-monitor]` 前缀，便于后续继续人工联调。

## 4. 方案实现情况对照

按设计文档章节对照，当前完成度可归纳如下。

已基本实现：

1. `7.1` 第一阶段服务层抽离
2. `7.2` 第二阶段拖拽链路接入
3. `7.3` 第三阶段配置迁移
4. `6.3` 坐标模型中的 `display-relative` 和 `desktop-global` 持久化
5. `6.5` 跨屏迁移链路
6. `6.6` 基于方向的相邻显示器筛选
7. `6.7` 启动恢复逻辑的主路径

已部分实现但仍需补齐：

1. `6.4` 配置升级的兼容策略只做了读取旧 `x/y` 和新结构写入，尚未看到完整的开关控制
2. `6.7` 对“显示器缺失、分辨率变化、全局点失效”有部分兜底，但还缺针对热插拔的主动回收逻辑
3. `8.2` 风险缓解中的日志与 `workArea` 统一已落实，但未见系统化测试

尚未实现或未证实已实现：

1. `6.2` 设计中的 `cross-screen-drag-controller.js` 独立模块化未完成
2. `6.8` 截图逻辑与“窗口当前所在显示器优先”的统一规则未落实
3. `7.4` 第四阶段截图与回归验证未完成
4. `8.3` 回滚策略中的 `ui.multi_monitor_free_move_enabled` 配置开关未实现
5. `9` 验收标准中的双屏、三屏、负坐标、上下堆叠、拔插恢复等场景没有看到成体系测试记录

## 5. 当前明确缺口

### 5.1 截图逻辑仍按鼠标所在屏幕选目标

[live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js) 的 `take-screenshot` 仍使用：

1. `screen.getCursorScreenPoint()`
2. `screen.getDisplayNearestPoint(cursorPoint)`

这与设计文档 `6.8` 中“窗口当前驻留显示器优先”的规则不一致。

影响：

1. 模型跨到副屏后，如果鼠标停在另一块屏幕，截图目标可能与桌宠当前驻留屏幕不一致
2. 设计目标里“拖拽与截图共用同一显示器上下文”的闭环还没有真正完成

### 5.2 功能开关未落地

设计文档 `8.3` 中明确提出保留 `ui.multi_monitor_free_move_enabled` 作为回滚点，但当前代码搜索不到该配置项的读写和分支控制。

影响：

1. 现在的实现一旦提交，将直接替换原有单屏逻辑
2. 若后续前置需求或联调发现问题，无法通过配置快速退回旧行为

### 5.3 新增核心模块仍未纳入 Git 跟踪

以下文件仍处于未跟踪状态：

1. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js)
2. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js)

影响：

1. 当前实现一旦切换分支、清理工作区或误操作，最核心的多屏服务层最容易丢失
2. 后续恢复开发时，首先要确认这两个文件仍在本地

### 5.4 当前文档状态与实际不一致

现有 [document/changelog/changelog-live2d-multi-monitor-free-move-20260316-v1.1.0.md](/d:/Github/my-neuro/document/changelog/changelog-live2d-multi-monitor-free-move-20260316-v1.1.0.md) 将状态写成了 `Implemented`，但当前事实是：

1. 代码仍未提交
2. 验收闭环未完成
3. 截图协同、开关控制、自动化验证仍缺失

因此后续应以本交接文档作为更准确的续做基线。

## 6. 后续衔接建议

若在前置需求完成后继续该需求，建议按以下顺序恢复：

1. 先保护现场：确认上述未跟踪文件仍在，并优先形成一个本地提交或备份
2. 先补回滚开关：在 [live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json)、[live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)、[live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js) 接入 `ui.multi_monitor_free_move_enabled`
3. 再对齐截图逻辑：让 [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js) 优先根据当前窗口所在显示器决定截图目标
4. 然后做人测回归：至少覆盖双屏左右、主屏在右副屏在左、三屏左右夹主屏、上下堆叠、负坐标、副屏断开重启恢复
5. 最后再考虑是否把跨屏拖拽控制从 [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js) 继续拆成独立模块

## 7. 建议验证清单

恢复开发时，建议最少验证以下场景：

1. 模型静止点击不会误触发跨屏
2. 仅在拖拽至边缘阈值时才跨屏
3. 从主屏拖到左副屏、右副屏都能正确选中相邻屏
4. 副屏坐标为负数时，重启后仍能恢复到正确显示器
5. 模型不会因旧配置中的异常比例而完全跑到可视区外
6. 鼠标停在 A 屏、桌宠驻留在 B 屏时，截图是否仍按预期选择 B 屏
7. 关闭多屏开关后，行为是否能回到旧的单屏限制逻辑

## 8. 关联项

### 8.1 需求

1. REQ-LIVE2D-MULTI-MONITOR-FREE-MOVE

### 8.2 任务

1. TASK-LIVE2D-MULTI-MONITOR-FREE-MOVE（待补充）

### 8.3 代码

1. [document/design/design-live2d-multi-monitor-free-move-20260316-v1.0.0.md](/d:/Github/my-neuro/document/design/design-live2d-multi-monitor-free-move-20260316-v1.0.0.md)
2. [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)
3. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)
4. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js)
5. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js)
6. [live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json)

### 8.4 测试

1. 当前未见自动化测试
2. 当前可确认的是存在过人工三屏联调痕迹，但未形成规范化测试记录

### 8.5 发布

1. Release 待补充

## 变更记录

| 日期 | 版本 | 修改人 | 变更类型 | 说明 |
|---|---|---|---|---|
| 2026-03-24 | v1.2.0 | Codex | 新建 | 基于 `4d97eab` 之后的工作区未提交实现，补充多屏自由移动需求的未完成实现交接记录 |
