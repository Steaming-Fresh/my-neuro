# Live2D 多屏自由移动设计方案

- 文档ID：DOC-DESIGN-LIVE2D-MMOVE-001
- 类型：Design
- 状态：Draft
- 当前版本：v1.0.0
- 创建日期：2026-03-16
- 更新日期：2026-03-16
- 作者：Codex / 项目维护组
- 评审人：待补充
- 关联需求：REQ-LIVE2D-MULTI-MONITOR-FREE-MOVE
- 关联任务：TASK-LIVE2D-MULTI-MONITOR-FREE-MOVE（待补充）
- 关联代码：Commit d6497fb（现状基线）
- 关联发布：Release 待补充

## 1. 背景与目标

当前 `my-neuro` 的 Live2D 宿主窗口仅按主显示器尺寸创建，且窗口移动边界、拖拽边界也全部绑定主显示器。

这会导致以下结果：

1. Live2D 模型只能在主屏范围内活动，无法自然拖到副屏或第三屏
2. 位置记忆仅基于当前窗口宽高比例保存，缺少显示器上下文
3. 多屏场景下，窗口行为、截图屏幕选择、模型位置恢复缺少统一坐标体系

本设计目标是：

1. 让 Live2D 模型在双屏、多屏下可连续拖动
2. 保持当前 Electron 单窗口桌宠架构，不引入多窗口常驻复杂度
3. 在现有 `main.js + renderer drag + config.json` 结构下最小化改造面
4. 为后续截图、位置恢复、显示器切换提供统一显示器服务层

## 2. 范围

### 2.1 包含范围

1. Live2D 宿主窗口的多显示器感知能力
2. 模型跨屏拖拽的事件链路与坐标转换方案
3. 模型位置记忆的持久化结构升级
4. 显示器拓扑查询、邻接判定、目标显示器迁移逻辑
5. 与截图显示器识别逻辑的兼容约束

### 2.2 不包含范围

1. 旧设计文档的延续性兼容要求
2. 多 Live2D 窗口同时驻留在不同屏幕
3. VRM 模式的多屏拖拽同步改造
4. 完整实现代码与自动化测试落地
5. 非 Windows 平台的专项适配细节

## 3. 现状问题分析

### 3.1 当前项目中的直接限制

现状基线位于 [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js) 与 [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)。

主要限制点：

1. `createWindow()` 使用 `screen.getPrimaryDisplay().workAreaSize` 创建窗口，窗口物理尺寸只覆盖主屏
2. `win.setPosition(0, 0)` 固定从主屏左上角启动
3. `will-move` 的边界判断只使用主显示器尺寸
4. `ipcMain.on('window-move')` 的边界裁剪也只使用主显示器宽高
5. 渲染层保存的 `model_position.x/y` 是相对当前窗口的比例，不是全局桌面坐标

这意味着：

1. 即使模型在渲染层可以拖动，本质上也只是“在主屏全屏透明窗口内部移动”
2. 只要窗口本身不跨屏，模型就不可能真正跨屏
3. 多屏恢复时无法知道上次模型属于哪个显示器

### 3.2 当前方案中潜在但未闭合的能力

当前主进程已经引入了 `screen`、截图逻辑也已经使用了：

1. `screen.getAllDisplays()`
2. `screen.getDisplayNearestPoint()`
3. 鼠标所在屏幕识别

说明项目已经具备“显示器感知”的基础，只是拖拽链路没有接入同一套模型。

## 4. N.E.K.O 可借鉴点

参考目录位于 `reference-projects/N.E.K.O`。

本次设计不直接照搬其宿主技术栈，而是借鉴以下思路：

### 4.1 显示层与业务层解耦

N.E.K.O 将前端显示逻辑拆分为独立模块，例如：

1. `static/live2d-init.js`
2. `static/live2d-ui-drag.js`
3. `static/app-screen.js`

这种拆分方式的价值在于：

1. 拖拽、显示器状态、屏幕能力不是散落在单文件里的临时逻辑
2. 多屏相关能力可以作为独立服务接入，而不是硬编码到模型事件里

### 4.2 保存显示器上下文并恢复窗口位置

N.E.K.O 在 [reference-projects/N.E.K.O/static/live2d-init.js](/d:/Github/my-neuro/reference-projects/N.E.K.O/static/live2d-init.js#L387) 附近已经体现出一条关键思路：

1. 为模型偏好保存 `display.screenX / screenY`
2. 初始化时通过 `window.electronScreen.moveWindowToDisplay()` 恢复到对应显示器

这说明它采用的不是“只存窗口内相对比例”，而是“存显示器上下文 + 屏幕级位置线索”。

这正是当前项目缺失的核心能力。

### 4.3 拖拽逻辑只对当前可视容器做局部约束

N.E.K.O 的 [reference-projects/N.E.K.O/static/live2d-ui-drag.js](/d:/Github/my-neuro/reference-projects/N.E.K.O/static/live2d-ui-drag.js#L242) 对拖拽组件做的是“窗口内局部边界约束”。

对本项目的启发是：

1. 渲染层只负责当前窗口内的拖拽体验
2. 跨显示器切换不应由渲染层直接推断完整桌面拓扑
3. 跨屏决策应由主进程显示器服务统一处理

## 5. 新方案总览

本方案采用：

`显示器拓扑服务 + 跨屏迁移式拖拽 + 全局桌面坐标持久化`

核心原则：

1. 保持单个透明桌宠窗口
2. 窗口始终只驻留在一个显示器的工作区内
3. 当模型拖到当前显示器边缘并越过迁移阈值时，主进程把窗口迁移到目标显示器
4. 迁移后将模型位置重映射到新显示器局部坐标，形成“连续拖动”的体感
5. 配置中保存“显示器信息 + 该显示器内相对位置 + 全局屏幕坐标快照”

## 6. 方案说明

### 6.1 为什么不采用“超大虚拟桌面单窗口”

理论上可以把透明窗口直接扩展到所有显示器组成的虚拟桌面矩形，但本项目不建议作为第一阶段方案，原因如下：

1. 当前项目使用 `type: 'desktop'`、点击穿透、截图隐藏等能力，超大透明窗口会增加穿透与焦点问题
2. 聊天框、悬浮 UI、模型交互区域都默认以单显示器窗口为容器，改造面过大
3. 多 DPI 显示器组合下，超大窗口更容易出现缩放、命中区域、截图错位问题
4. 当前截图逻辑已经按“当前所在显示器”做选择，单显示器驻留窗口更容易与之对齐

因此，本方案优先采用“跨屏迁移式拖拽”。

### 6.2 架构调整

建议将目前散落在 `main.js` 中的显示器相关逻辑抽象为三个模块：

1. `live-2d/js/main/display-topology-service.js`
2. `live-2d/js/main/window-placement-service.js`
3. `live-2d/js/model/cross-screen-drag-controller.js`

职责划分：

`display-topology-service`

1. 获取 `screen.getAllDisplays()`
2. 计算显示器工作区、边界、邻接关系
3. 提供“某个全局点属于哪个显示器”的查询能力

`window-placement-service`

1. 基于显示器工作区创建和迁移窗口
2. 将窗口移动到指定显示器
3. 计算迁移前后模型局部坐标映射

`cross-screen-drag-controller`

1. 在渲染层监听模型拖拽
2. 当接近边界时向主进程请求跨屏判定
3. 在迁移完成后应用新的模型局部坐标

### 6.3 坐标模型

新增三套坐标定义：

1. `display-local`
   当前显示器工作区内的局部坐标，原点为当前窗口左上角
2. `desktop-global`
   全部显示器组成的虚拟桌面坐标，原点遵循 Electron `screen` 的全局坐标体系，可出现负数
3. `display-relative`
   相对于当前显示器工作区宽高的比例，用于分辨率变化时恢复位置

持久化时同时保存：

1. 当前显示器 `id`
2. 当前显示器 `bounds/workArea`
3. `desktop-global` 快照
4. `display-relative` 快照

这样可以处理：

1. 同一显示器分辨率变化
2. 显示器顺序变化
3. 某块显示器暂时缺失

### 6.4 配置结构升级

建议把当前：

```json
"model_position": {
  "x": 1.2534,
  "y": 1.1766,
  "remember_position": true
}
```

升级为：

```json
"model_position": {
  "remember_position": true,
  "display_id": 2528732444,
  "display_relative": {
    "x": 0.82,
    "y": 0.78
  },
  "desktop_global": {
    "x": 3012,
    "y": 744
  },
  "display_snapshot": {
    "x": 1920,
    "y": 0,
    "width": 2560,
    "height": 1440
  }
}
```

兼容策略：

1. 读取到旧结构时，按当前窗口尺寸兜底转换为 `display_relative`
2. 新版本保存时统一写入新结构
3. 若显示器 `id` 不存在，则退回 `desktop_global`
4. 若 `desktop_global` 也失效，则退回默认位置

### 6.5 拖拽迁移链路

建议链路如下：

1. 渲染层按现有方式更新模型在当前窗口内的位置
2. 每次拖拽时计算模型锚点的 `desktop-global` 坐标
3. 当锚点越过当前显示器边缘阈值时，发送 IPC：`request-cross-display-transfer`
4. 主进程根据全局点查找目标显示器
5. 若目标显示器与当前显示器不同，则主进程迁移窗口到目标显示器
6. 主进程返回新显示器工作区信息与局部坐标建议值
7. 渲染层把模型位置更新到新窗口坐标系，拖拽继续

迁移阈值建议：

1. 左右边缘：模型交互锚点越过边缘 `24px`
2. 上下边缘：锚点越过边缘 `24px`
3. 迁移后增加 `300ms` 防抖，避免在交界处来回抖动

### 6.6 显示器邻接判定

目标显示器不建议只靠“最近点”简单判断，应增加边缘方向约束：

1. 向左越界，只从左侧相邻显示器候选集中选择
2. 向右越界，只从右侧相邻显示器候选集中选择
3. 向上、向下同理

原因：

1. 多屏布局可能存在上下错位
2. 单纯最近点在 L 型、T 型布局下容易误选

邻接关系可基于显示器 `workArea` 的矩形边界预计算。

### 6.7 启动恢复逻辑

启动时恢复顺序建议如下：

1. 读取 `model_position`
2. 根据 `display_id` 查找显示器
3. 若找到，则先把窗口创建在该显示器工作区
4. 再按 `display_relative` 恢复模型局部位置
5. 若 `display_id` 未命中，但 `desktop_global` 仍落在某显示器内，则迁移到该显示器
6. 全部失败时使用默认位置

这部分直接借鉴了 N.E.K.O 的“保存显示器信息并在初始化阶段恢复窗口”的思路，但实现落在当前项目的 Electron 主进程。

### 6.8 与截图逻辑的协同

当前截图逻辑已能根据鼠标所在屏幕选择目标显示器，但多屏拖拽落地后，还需统一以下规则：

1. 若窗口当前驻留显示器与鼠标所在显示器不同，优先使用窗口所在显示器
2. 若用户主动切换到另一块屏幕操作，再退回鼠标所在显示器
3. 显示器服务层应提供“当前窗口所在显示器”查询接口，避免截图与拖拽分裂

### 6.9 与聊天框拖拽的关系

当前聊天框拖拽是纯 DOM 拖拽，只在当前窗口内生效。

建议第一阶段：

1. 仅支持 Live2D 模型跨屏
2. 聊天框继续限制在当前窗口内
3. 当窗口跨屏后，聊天框作为窗口内容整体随窗口移动

这样可以避免把“聊天框单独跨屏”与“模型跨屏”混成一个问题。

## 7. 实施步骤建议

### 7.1 第一阶段：服务层抽离

1. 从 `main.js` 抽离显示器拓扑与窗口定位逻辑
2. 提供 `getCurrentDisplayForWindow()`、`moveWindowToDisplay()`、`resolveDisplayByPoint()` 等接口
3. 替换主显示器硬编码

### 7.2 第二阶段：拖拽链路接入

1. 在 `model-interaction.js` 中增加跨屏拖拽控制器
2. 发送跨屏 IPC 请求
3. 完成迁移后的局部坐标重映射

### 7.3 第三阶段：配置迁移

1. 升级 `config.json` 中 `ui.model_position`
2. 增加旧配置兼容读取
3. 保存显示器信息与全局坐标快照

### 7.4 第四阶段：截图与回归

1. 对齐窗口所在显示器与截图所在显示器判断
2. 验证主屏在左、副屏在右；副屏在左、主屏在右；上下堆叠；负坐标布局

## 8. 风险与回滚

### 8.1 主要风险

1. 显示器 DPI 不一致导致模型落点与鼠标感知存在偏差
2. 窗口迁移瞬间可能出现拖拽中断或闪动
3. `type: 'desktop'` 窗口在不同 Windows 版本上的行为可能不一致
4. 旧配置升级后如果写回失败，可能出现位置恢复异常

### 8.2 风险缓解

1. 所有迁移计算统一基于 `workArea`，避免混用 `bounds` 与 `workAreaSize`
2. 增加跨屏迁移防抖和最小停留时间
3. 保留旧配置兜底读取
4. 在日志中打印显示器拓扑、迁移前后坐标、配置恢复路径

### 8.3 回滚策略

1. 保留一个配置开关：`ui.multi_monitor_free_move_enabled`
2. 若关闭该开关，则退回当前单显示器限制逻辑
3. 旧配置字段不删除，仅标记为兼容输入

## 9. 验收标准

1. 双屏左右布局下，模型可从主屏连续拖到副屏，再拖回主屏
2. 三屏布局下，模型可跨相邻显示器连续迁移，不出现随机跳屏
3. 副屏位于主屏左侧且坐标为负数时，模型仍可正常跨屏
4. 应用重启后，模型能恢复到上次所在显示器和近似位置
5. 显示器拔插后，模型不会丢失到不可见区域，能回退到默认可见位置
6. 截图功能在跨屏后仍能与当前窗口显示器保持一致
7. 关闭多屏自由移动开关后，行为退回单屏限制模式

## 10. 关联项

### 10.1 需求

1. REQ-LIVE2D-MULTI-MONITOR-FREE-MOVE

### 10.2 任务

1. TASK-LIVE2D-MULTI-MONITOR-FREE-MOVE（待补充）

### 10.3 代码

1. [live-2d/main.js](/d:/Github/my-neuro/live-2d/main.js)
2. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)
3. [reference-projects/N.E.K.O/static/live2d-init.js](/d:/Github/my-neuro/reference-projects/N.E.K.O/static/live2d-init.js#L387)
4. [reference-projects/N.E.K.O/static/live2d-ui-drag.js](/d:/Github/my-neuro/reference-projects/N.E.K.O/static/live2d-ui-drag.js#L242)
5. [reference-projects/N.E.K.O/static/app-screen.js](/d:/Github/my-neuro/reference-projects/N.E.K.O/static/app-screen.js#L215)

### 10.4 测试

1. 待补充：`tests/live2d/multi-monitor/`

### 10.5 发布

1. 待补充

## 变更记录

| 日期 | 版本 | 修改人 | 变更类型 | 说明 |
|---|---|---|---|---|
| 2026-03-16 | v1.0.0 | Codex | 新建 | 基于当前项目现状与 N.E.K.O 的显示器恢复思路，重新设计 Live2D 多屏自由移动方案 |
