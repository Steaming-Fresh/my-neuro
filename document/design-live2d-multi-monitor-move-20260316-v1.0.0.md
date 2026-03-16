# Live2D 双屏/多屏自由移动实现方案

- 文档ID：DOC-DESIGN-20260316-001
- 类型：Design
- 状态：Approved
- 当前版本：v1.0.0
- 创建日期：2026-03-16
- 更新日期：2026-03-16
- 作者：Copilot
- 评审人：项目维护组
- 关联需求：REQ-LIVE2D-MULTI-MONITOR-MOVE
- 关联任务：TASK-LIVE2D-001
- 关联代码：待补充
- 关联发布：待补充

## 1. 背景与目标

当前 Live2D 皮套在双屏/多屏环境下只能在单一屏幕内移动，无法跨屏拖拽，影响桌宠在多显示器场景的可用性。

本方案目标：

1. 允许 Live2D 窗口在双屏/多屏之间自由移动。
2. 保留原有“窗口常驻顶层、透明、可穿透”行为。
3. 保证单屏用户行为不退化。
4. 支持负坐标屏幕（主屏左侧/上方扩展屏）。

## 2. 现状分析（基于现有实现）

已确认根因集中在主进程窗口边界逻辑：

1. 创建窗口时仅使用主屏工作区尺寸，窗口大小固定为主屏大小。
2. 窗口移动拦截（will-move）仅按主屏宽高判断，超出即阻止。
3. IPC 拖拽处理（window-move）仅按主屏宽高做 clamp，导致坐标永远被钳制在主屏范围。

直接后果：

1. 即使用户在渲染层拖动模型，主进程仍会把窗口限制在主屏。
2. 在多屏扩展布局中，跨屏方向（尤其 x<0 或 y<0）被误判为非法。

## 3. 设计原则

1. 最小侵入：优先改主进程边界策略，不改业务功能链路。
2. 配置可控：提供开关，允许回退到单屏限制策略。
3. 渐进发布：先实现跨屏移动，再补充增强能力（吸附、快捷键跨屏切换）。
4. 可追溯：每一步改动对应文件、验收项、回滚策略。

## 4. 总体方案

### 4.1 核心思路

将“主屏边界限制”改为“虚拟桌面边界限制”。

Electron 的多屏能力来自 screen.getAllDisplays()；每个显示器有 bounds。将所有 bounds 合并为虚拟桌面矩形：

1. minX = 所有屏幕 bounds.x 的最小值
2. minY = 所有屏幕 bounds.y 的最小值
3. maxX = 所有屏幕 (bounds.x + bounds.width) 的最大值
4. maxY = 所有屏幕 (bounds.y + bounds.height) 的最大值

窗口移动时按虚拟桌面做统一 clamp，替代当前按主屏 clamp。

### 4.2 影响范围

主要影响文件：

1. live-2d/main.js

可选增强涉及文件：

1. live-2d/js/shortcut-manager.js
2. live-2d/config.json

## 5. 详细改造方案

### 5.1 主进程新增虚拟桌面边界计算

在 live-2d/main.js 增加函数：

1. getVirtualDesktopBounds()
2. clampWindowPositionToDesktop(win, x, y, margin)

建议逻辑：

```js
function getVirtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map(d => d.bounds.x));
  const minY = Math.min(...displays.map(d => d.bounds.y));
  const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function clampWindowPositionToDesktop(win, x, y, visibleMargin = 100) {
  const desktop = getVirtualDesktopBounds();
  const { width, height } = win.getBounds();
  const minX = desktop.minX - width + visibleMargin;
  const maxX = desktop.maxX - visibleMargin;
  const minY = desktop.minY - height + visibleMargin;
  const maxY = desktop.maxY - visibleMargin;
  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY))
  };
}
```

### 5.2 createWindow 阶段调整

当前窗口尺寸使用主屏工作区，建议改为虚拟桌面尺寸：

1. 窗口宽高 = 虚拟桌面宽高
2. 初始位置 = 虚拟桌面左上角（minX, minY）

这样能覆盖全桌面交互层，避免跨屏后交互区域丢失。

注意：

1. 若担心超大分辨率导致性能压力，可保留主屏大小，但必须放开移动边界；优先保证需求达成。
2. 初版建议先改边界，不立即扩大窗口；二阶段再评估性能与覆盖范围。

### 5.3 替换 will-move 拦截策略

将当前只允许主屏范围内移动的逻辑替换为：

1. 基于虚拟桌面的边界校验。
2. 不再简单 event.preventDefault()，改为“允许移动 + 必要时矫正坐标”。

推荐做法：

1. 在 will-move 中仅做轻量校验。
2. 在 moved 或自定义 IPC 移动路径中统一执行 clamp。

### 5.4 替换 IPC window-move 的 clamp 策略

当前逻辑：

1. 取主屏宽高。
2. 对 newX/newY 做主屏内钳制。

改造后：

1. 继续使用现有拖拽增量计算（兼容原交互体验）。
2. 调用 clampWindowPositionToDesktop() 做虚拟桌面钳制。

示例：

```js
ipcMain.on('window-move', (event, { mouseX, mouseY }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const [currentX, currentY] = win.getPosition();
  const next = clampWindowPositionToDesktop(win, currentX + mouseX, currentY + mouseY, 100);
  win.setPosition(next.x, next.y);
});
```

### 5.5 响应显示器热插拔

监听 display-added / display-removed / display-metrics-changed：

1. 显示器变更后刷新虚拟桌面边界。
2. 若当前窗口已落到非法区域，自动纠偏到最近合法区域。

目标：

1. 拔掉副屏后窗口不丢失。
2. 插入新屏后立即可拖入新屏。

### 5.6 配置项（建议新增）

在 live-2d/config.json 的 ui 下新增可选配置：

```json
"multi_monitor": {
  "enabled": true,
  "movement_mode": "virtual-desktop",
  "visible_margin": 100,
  "auto_reposition_on_display_change": true
}
```

含义：

1. enabled：总开关。
2. movement_mode：预留策略扩展（virtual-desktop / primary-only）。
3. visible_margin：保留可见区域，防止窗口完全移出。
4. auto_reposition_on_display_change：热插拔自动纠偏。

## 6. 兼容性与风险

### 6.1 兼容性

1. Windows 扩展屏（左右上下布局）支持。
2. DPI 缩放不一致场景，优先以 Electron bounds 逻辑坐标为准。
3. 单屏场景行为与现有一致。

### 6.2 风险点

1. 窗口设为虚拟桌面超大尺寸时，GPU/渲染开销上升。
2. 某些显卡/驱动下透明大窗可能有性能抖动。
3. 现有模型位置存储为相对当前窗口比例，多屏后可能出现初始位置偏差。

### 6.3 风险缓解

1. 第一阶段仅改移动边界，不改窗口尺寸。
2. 新增配置开关，可快速回退 primary-only 模式。
3. 在加载保存坐标时增加越界修正逻辑。

## 7. 实施步骤（建议排期）

### 阶段 A：最小可用版本（MVP）

1. 在 main.js 新增虚拟桌面边界函数。
2. 改造 window-move IPC 的 clamp。
3. 改造 will-move 拦截逻辑，放开主屏限制。
4. 手工验证双屏左右布局跨屏拖拽。

交付标准：

1. 能从主屏拖到副屏，再拖回主屏。
2. 负坐标屏（左副屏）可正常进入。

### 阶段 B：稳定性增强

1. 加入 display-added/display-removed 监听。
2. 插拔显示器后窗口自动纠偏。
3. 添加配置项 multi_monitor。

交付标准：

1. 拔掉副屏后窗口可见。
2. 配置关闭后恢复主屏限制策略。

### 阶段 C：体验优化（可选）

1. 新增快捷键“移动到下一个屏幕中心”。
2. 增加边缘吸附（屏幕边缘吸附）。
3. 设置面板中增加多屏行为选项。

## 8. 测试方案

### 8.1 功能测试

1. 双屏横向：主屏在左，副屏在右，双向拖拽。
2. 双屏横向：主屏在右，副屏在左（验证负坐标）。
3. 双屏纵向：副屏在上/下。
4. 三屏链路：左中右连续移动。
5. 移动过程中保持点击、穿透、置顶行为正确。

### 8.2 异常测试

1. 拖拽到边界极限，窗口不丢失。
2. 正在副屏时拔掉副屏，窗口自动回可见区域。
3. DPI 不一致（100% + 150%）下拖拽连续性。

### 8.3 回归测试

1. 模型点击动作、表情、聊天框拖拽正常。
2. 截图功能在多屏下仍按鼠标所在屏工作。
3. 全局快捷键功能无回归。

## 9. 验收标准

满足以下全部条件即验收通过：

1. 用户可在双屏/多屏间自由移动 Live2D 皮套。
2. 不出现“跨屏即被拉回主屏”的现象。
3. 单屏用户行为与旧版本一致。
4. 显示器热插拔后窗口仍可被用户找回。
5. 关键功能（语音、动作、截图、快捷键）无明显回归。

## 10. 回滚策略

1. 配置回滚：multi_monitor.enabled=false 或 movement_mode=primary-only。
2. 代码回滚：仅回滚 main.js 中多屏边界相关提交，不影响其他模块。
3. 发布回滚：若出现兼容问题，发布热修复恢复单屏限制并保留日志采样。

## 11. 实施清单（开发打卡）

1. main.js 新增虚拟桌面边界函数
2. main.js 改造 window-move IPC
3. main.js 改造 will-move 拦截
4. main.js 增加显示器变更监听
5. config.json 增加 multi_monitor 配置
6. 冒烟测试与回归测试记录

## 12. 变更记录

| 日期 | 版本 | 修改人 | 变更类型 | 说明 |
|---|---|---|---|---|
| 2026-03-16 | v1.0.0 | Copilot | 新建 | 建立双屏/多屏自由移动完整实现方案 |
