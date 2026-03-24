# Live2D 模型自适应点击拖拽区域实现记录

- 文档ID：DOC-CHANGELOG-LIVE2D-HITAREA-001
- 类型：ChangeLog
- 状态：Draft
- 当前版本：v1.0.0
- 创建日期：2026-03-24
- 更新日期：2026-03-24
- 作者：Codex / 项目维护组
- 评审人：待补充
- 关联需求：REQ-LIVE2D-ADAPTIVE-HIT-AREA
- 关联任务：TASK-LIVE2D-ADAPTIVE-HIT-AREA（待补充）
- 关联代码：当前工作区未提交实现（2026-03-24）
- 关联发布：Release 待补充

## 1. 背景与目标

记录本次 Live2D 模型点击拖拽热区改造的实际落地情况，说明当前已实现内容、接入点、已知限制与后续验证重点。

本次改造目标是：

1. 去掉固定矩形热区作为主判定
2. 让点击拖拽尽量贴合模型真实可见身体区域
3. 让不同 Live2D 皮套切换后无需重新手工调矩形
4. 同步改善鼠标穿透与误触空气拖动的问题

## 2. 范围

### 2.1 本次已实现

1. 新增基于模型可见像素 Alpha 的命中服务
2. 将 Live2D 模型 `containsPoint()` 改为走自适应命中判定
3. 将拖拽起点、点击动作、滚轮缩放接入新命中链路
4. 保留聊天框区域优先可交互
5. 新增命中相关配置项与回退开关
6. 调整 `model.hitTest()`，使其与新的命中服务保持一致
7. 为人工验证补充安全默认位置与控制面板可交互修复

### 2.2 本次未实现

1. VRM 模式命中逻辑同步改造
2. 命中调试可视化 UI
3. 自动化测试
4. 动作切换场景下的专项性能压测
5. 多模型并存场景的命中优先级处理

## 3. 实现说明

### 3.1 新增命中服务模块

新增文件：

1. [live-2d/js/model/model-hit-test-service.js](/d:/Github/my-neuro/live-2d/js/model/model-hit-test-service.js)

职责：

1. 提供 `containsInteractivePoint()` 统一命中入口
2. 区分聊天框命中与模型身体命中
3. 通过离屏纹理像素 Alpha 采样判定模型是否被点中
4. 提供邻域采样容错，降低发丝边缘难点中的问题
5. 提供缓存脏标记和 TTL 刷新，避免每次都做高成本重建
6. 在新命中不可用时回退到旧 `containsPoint()` 或包围盒语义

### 3.2 渲染层交互改造

改动文件：

1. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)

已完成改动：

1. 引入 `ModelHitTestService`
2. 初始化模型时同步初始化命中服务
3. 原先基于 `model.width / 3` 与 `model.height * 0.7` 的矩形热区不再作为主命中逻辑
4. `model.containsPoint()` 被改为统一调用命中服务
5. `mousedown` 只有命中真实可交互区域时才允许进入拖拽
6. 点击动作与滚轮缩放也统一复用新的命中结果
7. 在缩放、窗口 resize、初始恢复位置、点击触发动作后，会标记命中缓存失效并刷新

### 3.3 模型级 hitTest 兼容改造

改动文件：

1. [live-2d/js/model/model-setup.js](/d:/Github/my-neuro/live-2d/js/model/model-setup.js)

已完成改动：

1. `model.hitTest()` 优先委托给 `modelController.hitTestPoint()`
2. 若控制器不可用，再退回模型包围盒判定

这样可以让依赖 `model.hitTest()` 的后续逻辑，不再继续绑定旧矩形热区概念。

### 3.4 配置项接入

改动文件：

1. [live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json)

新增配置：

1. `ui.adaptive_hit_test_enabled`
2. `ui.hit_test_debug_enabled`
3. `ui.hit_test_alpha_threshold`
4. `ui.hit_test_sample_radius`
5. `ui.hit_test_cache_ttl_ms`

默认值说明：

1. 自适应命中默认开启
2. 调试日志默认关闭
3. Alpha 阈值默认 `32`
4. 采样半径默认 `1`，即轻量邻域容错
5. 缓存 TTL 默认 `120ms`

### 3.5 为验证追加的可见性与交互修复

补充改动文件：

1. [live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json)
2. [live-2d/js/ui/ui-controller.js](/d:/Github/my-neuro/live-2d/js/ui/ui-controller.js)

已完成改动：

1. 将 `ui.model_position` 调整为更安全的可见默认值，避免模型因旧位置数据恢复到屏幕外
2. 将 `ui.model_scale` 调整为更容易直接观察的默认值，便于本轮人工验证
3. 在 `UIController` 中将右下角 `model-controls` 控制面板纳入鼠标穿透例外区域
4. 即使模型当前不可见或未命中，控制面板也应能稳定接收鼠标进入与点击`r`n5. 为 Live2D 模式补充控制面板接线，使齿轮按钮可以展开面板，重置按钮可以把模型恢复到可见区域

## 4. 当前行为变化

本次改造后，预期行为变化如下：

1. 鼠标必须点到模型真实可见区域，才会开始拖拽
2. 模型周边透明背景不再应当触发“虚空拖动”
3. 当模型半移出屏幕时，只要屏幕内仍有可见头发或身体，理论上可以直接抓住可见部分拖回
4. 切换不同留白和体型的 Live2D 模型时，命中区域会跟随当前渲染结果变化，而不是继续使用固定比例矩形
5. 聊天框仍维持优先可交互，不受模型像素命中影响
6. 默认位置恢复异常时，模型应优先出现在屏幕内可见区域
7. 右下角控制面板即使在模型未命中时也应可点击`r`n8. Live2D 模式下，齿轮按钮应能展开面板，重置按钮应能把模型拉回屏幕内

## 5. 已知限制与风险

### 5.1 当前已知限制

1. 新命中服务目前只接入了 Live2D 模式，VRM 模式未同步改造
2. 命中缓存当前基于 TTL 和脏标记刷新，尚未对所有动作变化做更细粒度事件联动
3. 还没有实机性能数据来确认高频鼠标移动时的最终开销
4. 目前没有可视化调试层，排障仍主要依赖日志和体感验证

### 5.2 风险缓解

1. 保留 `ui.adaptive_hit_test_enabled` 作为快速回退开关
2. 保留对旧 `containsPoint()` 的 fallback
3. 用单点加小邻域采样替代大范围扫描，控制读回成本
4. 将缓存刷新控制在缩放、resize、初始化恢复、动作触发等关键节点

## 6. 验证情况

### 6.1 已完成验证

1. 对 [live-2d/js/model/model-hit-test-service.js](/d:/Github/my-neuro/live-2d/js/model/model-hit-test-service.js) 做了语法级检查
2. 对 [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js) 做了语法级检查
3. 对 [live-2d/js/model/model-setup.js](/d:/Github/my-neuro/live-2d/js/model/model-setup.js) 做了语法级检查

### 6.2 尚未完成验证

1. 未完成 Electron 运行时实机验证
2. 未完成“模型半出屏后抓头发拖回”的人工场景验证
3. 未完成“切换多套皮套后自动适配”的人工场景验证
4. 未完成命中性能与误触率评估

## 7. 后续建议

建议下一步至少补以下验证与收尾：

1. 人工验证半出屏抓取、空气误触消失、不同皮套自动适配三类核心场景
2. 若体感边缘仍难点中，可微调 `hit_test_alpha_threshold` 或 `hit_test_sample_radius`
3. 若高频移动卡顿明显，可进一步优化缓存刷新策略
4. 稳定后再为 VRM 模式补齐同类命中方案
5. 如需长期维护，建议再补一版命中调试可视化

## 8. 关联项

### 8.1 需求

1. REQ-LIVE2D-ADAPTIVE-HIT-AREA

### 8.2 任务

1. TASK-LIVE2D-ADAPTIVE-HIT-AREA（待补充）

### 8.3 代码

1. [document/design/design-live2d-adaptive-hit-area-20260324-v1.0.0.md](/d:/Github/my-neuro/document/design/design-live2d-adaptive-hit-area-20260324-v1.0.0.md)
2. [live-2d/js/model/model-hit-test-service.js](/d:/Github/my-neuro/live-2d/js/model/model-hit-test-service.js)
3. [live-2d/js/model/model-interaction.js](/d:/Github/my-neuro/live-2d/js/model/model-interaction.js)
4. [live-2d/js/model/model-setup.js](/d:/Github/my-neuro/live-2d/js/model/model-setup.js)
5. [live-2d/js/ui/ui-controller.js](/d:/Github/my-neuro/live-2d/js/ui/ui-controller.js)
6. [live-2d/config.json](/d:/Github/my-neuro/live-2d/config.json)

### 8.4 测试

1. 当前仅完成语法级检查
2. 建议补充人工验证场景：半出屏抓取、不同皮套切换、不同缩放、长时间悬停与拖拽

### 8.5 发布

1. Release 待补充

## 变更记录

| 日期 | 版本 | 修改人 | 变更类型 | 说明 |
|---|---|---|---|---|
| 2026-03-24 | v1.0.0 | Codex | 新建 | 记录 Live2D 模型自适应点击拖拽区域的本次代码实现情况 |
| 2026-03-24 | v1.0.0 | Codex | 补充 | 为便于人工验证，补充模型安全默认位置与控制面板可交互修复 |

