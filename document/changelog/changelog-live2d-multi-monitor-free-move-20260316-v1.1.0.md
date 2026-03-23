# Live2D 多屏自由移动实现记录

- 文档ID：DOC-CHANGELOG-LIVE2D-MMOVE-001
- 类型：ChangeLog
- 状态：Implemented
- 当前版本：v1.1.0
- 创建日期：2026-03-16
- 更新日期：2026-03-16
- 作者：Codex / 项目维护组
- 评审人：待补充
- 关联需求：REQ-LIVE2D-MULTI-MONITOR-FREE-MOVE
- 关联任务：TASK-LIVE2D-MULTI-MONITOR-FREE-MOVE（待补充）
- 关联代码：Commit 4d97eab（当前工作区基线）
- 关联发布：Release 待补充

## 1. 背景与目标

记录本次 Live2D 多屏自由移动实现过程中的实际改动、运行期问题与修复结果，作为后续继续迭代的实现追踪文档。

## 2. 范围

### 2.1 本次已实现

1. 主进程显示器拓扑服务
2. 基于显示器工作区的窗口创建与迁移
3. 渲染层拖拽时的跨屏触发逻辑
4. 模型位置从旧的纯相对比例保存，升级为带显示器上下文的结构
5. 启动时按保存的显示器信息恢复窗口所在屏幕
6. 面向人工排障的多屏调试日志
7. 针对模型不可见和误触发跨屏的两轮运行期修复

### 2.2 本次未实现

1. 聊天框独立跨屏拖拽
2. 多 DPI 显示器专项校准
3. 自动化测试
4. 显示器热插拔后的主动回收策略
5. 配置开关 `ui.multi_monitor_free_move_enabled`

## 3. 实现说明

### 3.1 新增主进程服务

新增文件：

1. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js)
2. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js)

职责：

1. 读取所有显示器
2. 按方向查找相邻显示器
3. 生成窗口工作区 bounds
4. 在显示器间迁移窗口
5. 生成带显示器上下文的模型位置存档

### 3.2 主进程接入点

改动文件：

1. [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)

已完成改动：

1. 窗口创建从“固定主显示器”改为“按保存位置解析初始显示器”
2. `will-move` 边界判断改为基于当前窗口所在显示器
3. 旧 `window-move` IPC 的边界逻辑同步切换到当前显示器
4. 新增 `transfer-model-to-display` IPC，用于拖拽时跨屏迁移
5. `save-model-position` 改为保存 `display_id`、`display_relative`、`desktop_global`、`display_snapshot`

### 3.3 渲染层拖拽接入点

改动文件：

1. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)

已完成改动：

1. 模型拖拽时检测鼠标是否接近当前窗口边缘
2. 触发 `transfer-model-to-display` 请求
3. 窗口迁移后，按新的局部指针坐标重新计算模型位置
4. 增加迁移防抖，避免交界处反复跳屏
5. 启动恢复位置时优先读取 `display_relative`
6. 保存位置时兼容写回旧字段 `x/y`，避免旧逻辑立即失效

### 3.4 已加入人工调试日志

本次额外加入了以 `[multi-monitor]` 为前缀的人工调试日志，覆盖以下节点：

1. 显示器列表读取
2. 窗口当前所在显示器判定
3. 启动时初始显示器恢复路径
4. 拖拽触边后的跨屏请求参数
5. 相邻显示器候选与最终选中结果
6. 窗口跨屏迁移前后的 bounds
7. 渲染层迁移后的模型局部坐标
8. 模型位置保存时写入的显示器上下文

这些日志主要用于双屏或多屏人工测试时快速定位：

1. 为什么没有触发迁移
2. 为什么迁移到了错误的屏幕
3. 为什么重启后恢复到了错误位置

### 3.5 可见区保护修复

根据首次三屏实测，发现一种已落地问题：

1. 窗口能恢复到目标显示器
2. 但旧配置中的 `display_relative` 可能已经越界
3. 结果是输入框和浮层可见，但模型被恢复到窗口可视区外

为此补充的保护逻辑：

1. 模型启动恢复位置后立即执行可见区钳制
2. 跨屏迁移后再次执行可见区钳制
3. 保存位置前也执行一次可见区钳制，避免继续写入明显异常的越界坐标

### 3.6 坐标系修复

根据三屏运行日志，确认跨屏判定链路此前误用了 PIXI 内部坐标：

1. `e.data.global` 可能大于当前窗口的 CSS 像素尺寸
2. 导致普通点击也被误判为“已越过右边界”
3. 进一步造成窗口错误迁移到右侧副屏

本次修复后：

1. 跨屏判定统一使用窗口 CSS 像素坐标
2. 模型位置保存也统一转换为窗口 CSS 像素坐标
3. 主进程显示器迁移逻辑与渲染层拖拽坐标体系保持一致

## 4. 风险与回滚

### 4.1 当前已知风险

1. 迁移触发基于窗口边缘阈值，复杂多屏布局下仍可能存在误切换
2. 上下堆叠屏幕和异形排列还未做专项人工验证
3. 迁移瞬间依赖窗口 resize 事件，极端情况下可能出现一次轻微跳动
4. `go.bat` 启动提示仍存在编码异常，不影响 Electron 启动，但影响调试可读性

### 4.2 回滚点

若需要快速回滚，本次主要改动集中在：

1. [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)
2. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)
3. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js)
4. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js)

## 5. 验收标准

1. 双屏左右布局下，点击模型本体不会误触发跨屏
2. 只有在模型拖拽接近窗口边缘时才触发跨屏请求
3. 三屏布局下，主屏左右副屏都能被正确识别为相邻显示器
4. 重启后模型不会因为越界坐标而完全不可见
5. 保存后的 `display_relative` 不再出现明显超出合理范围的异常值
6. 跨屏后截图功能仍符合预期

## 6. 关联项

### 6.1 需求

1. REQ-LIVE2D-MULTI-MONITOR-FREE-MOVE

### 6.2 任务

1. TASK-LIVE2D-MULTI-MONITOR-FREE-MOVE（待补充）

### 6.3 代码

1. [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)
2. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)
3. [live-2d/js/main/display-topology-service.js](/d:/Github/my-neuro/live-2d/js/main/display-topology-service.js)
4. [live-2d/js/main/window-placement-service.js](/d:/Github/my-neuro/live-2d/js/main/window-placement-service.js)
5. [document/design/design-live2d-multi-monitor-free-move-20260316-v1.0.0.md](/d:/Github/my-neuro/document/design/design-live2d-multi-monitor-free-move-20260316-v1.0.0.md)

### 6.4 测试

1. 待补充：`tests/live2d/multi-monitor/`
2. 当前为人工三屏验证（主屏居中，左右各一块副屏）

### 6.5 发布

1. Release 待补充

## 变更记录

| 日期 | 版本 | 修改人 | 变更类型 | 说明 |
|---|---|---|---|---|
| 2026-03-16 | v1.0.0 | Codex | 新建 | 建立 Live2D 多屏自由移动实现记录 |
| 2026-03-16 | v1.1.0 | Codex | 补充 | 补充人工调试日志、可见区保护修复与坐标系修复记录 |
