const { ipcRenderer } = require('electron');
const { ModelHitTestService } = require('./model-hit-test-service');

// 模型交互控制器类
class ModelInteractionController {
    constructor() {
        this.model = null;
        this.app = null;
        this.interactionWidth = 0;
        this.interactionHeight = 0;
        this.interactionX = 0;
        this.interactionY = 0;
        this.isDragging = false;
        this.isDraggingChat = false;
        this.dragOffset = { x: 0, y: 0 };
        this.chatDragOffset = { x: 0, y: 0 };
        this.config = null;
        this.crossDisplayTransferInFlight = false;
        this.lastCrossDisplayTransferAt = 0;
        this.crossDisplayTransferCooldownMs = 300;
        this.crossDisplayEdgeThreshold = 32;
        this.hitTestService = new ModelHitTestService();
    }

    // 初始化模型和应用
    init(model, app, config = null) {
        this.model = model;
        this.app = app;
        this.config = config;
        this.hitTestService.setConfig(config);
        this.hitTestService.init(model, app, config);
        this.updateInteractionArea();
        this.setupInteractivity();
    }

    getCurrentModelBounds() {
        if (!this.model || typeof this.model.getBounds !== 'function') {
            return null;
        }

        try {
            const bounds = this.model.getBounds();
            if (!bounds) {
                return null;
            }

            return {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            };
        } catch (error) {
            return null;
        }
    }

    // 更新交互区域大小和位置
    updateInteractionArea() {
        const bounds = this.getCurrentModelBounds();
        if (!bounds) {
            return;
        }

        this.interactionWidth = bounds.width;
        this.interactionHeight = bounds.height;
        this.interactionX = bounds.x;
        this.interactionY = bounds.y;
    }

    getCanvasMetrics() {
        if (!this.app || !this.app.renderer || !this.app.renderer.view) {
            return null;
        }

        const view = this.app.renderer.view;
        const rect = view.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return null;
        }

        return {
            rect,
            scaleX: view.width / rect.width,
            scaleY: view.height / rect.height
        };
    }

    toWindowPixels(point) {
        const metrics = this.getCanvasMetrics();
        if (!metrics) {
            return { x: point.x, y: point.y };
        }

        return {
            x: point.x / metrics.scaleX,
            y: point.y / metrics.scaleY
        };
    }

    modelPositionToWindowPixels() {
        return this.toWindowPixels({ x: this.model.x, y: this.model.y });
    }

    hitTestPoint(point, { includeChat = false } = {}) {
        if (!this.hitTestService) {
            return false;
        }

        return this.hitTestService.containsInteractivePoint(point, { includeChat });
    }

    // 设置交互性
    setupInteractivity() {
        if (!this.model) return;

        this.model.interactive = true;

        const originalContainsPoint = typeof this.model.containsPoint === 'function'
            ? this.model.containsPoint.bind(this.model)
            : null;
        this.hitTestService.setFallbackContainsPoint(originalContainsPoint);

        // 覆盖原始的containsPoint方法，改为基于真实可见像素命中
        this.model.containsPoint = (point) => {
            return this.hitTestService.containsInteractivePoint(point, { includeChat: true });
        };

        // 鼠标按下事件
        this.model.on('mousedown', (e) => {
            const point = e.data.global;
            const windowPoint = this.toWindowPixels(point);
            if (this.model.containsPoint(point)) {
                this.isDragging = true;
                this.dragOffset.x = point.x - this.model.x;
                this.dragOffset.y = point.y - this.model.y;
                console.log('[multi-monitor] drag start:', {
                    pointer: { x: point.x, y: point.y },
                    windowPointer: windowPoint,
                    dragOffset: this.dragOffset,
                    modelPosition: { x: this.model.x, y: this.model.y }
                });
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        // 鼠标移动事件
        this.model.on('mousemove', async (e) => {
            if (this.isDragging) {
                const newX = e.data.global.x - this.dragOffset.x;
                const newY = e.data.global.y - this.dragOffset.y;
                this.model.position.set(newX, newY);
                this.updateInteractionArea();
                await this.maybeTransferAcrossDisplays(e.data.global);
            }
        });

        // 全局鼠标释放事件
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                console.log('[multi-monitor] drag end:', {
                    modelPosition: { x: this.model.x, y: this.model.y },
                    windowModelPosition: this.modelPositionToWindowPixels()
                });
                this.isDragging = false;
                this.saveModelPosition();
                setTimeout(() => {
                    if (!this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true,
                            options: { forward: true }
                        });
                    }
                }, 100);
            }
        });

        const chatContainer = document.getElementById('text-chat-container');

        if (chatContainer) {
            chatContainer.addEventListener('mousedown', (e) => {
                if (e.target === chatContainer || e.target.id === 'chat-messages') {
                    this.isDraggingChat = true;
                    this.chatDragOffset.x = e.clientX - chatContainer.getBoundingClientRect().left;
                    this.chatDragOffset.y = e.clientY - chatContainer.getBoundingClientRect().top;
                    e.preventDefault();
                    ipcRenderer.send('set-ignore-mouse-events', {
                        ignore: false
                    });
                }
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingChat && chatContainer) {
                chatContainer.style.left = `${e.clientX - this.chatDragOffset.x}px`;
                chatContainer.style.top = `${e.clientY - this.chatDragOffset.y}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isDraggingChat) {
                this.isDraggingChat = false;
                setTimeout(() => {
                    if (!this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true,
                            options: { forward: true }
                        });
                    }
                }, 100);
            }
        });

        this.model.on('mouseover', () => {
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        this.model.on('mouseout', () => {
            if (!this.isDragging) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true,
                    options: { forward: true }
                });
            }
        });

        this.model.on('click', () => {
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global) && this.model.internalModel) {
                this.model.motion('Tap');
                this.model.expression();
                this.hitTestService.markCacheDirty('tap-motion');
            }
        });

        window.addEventListener('wheel', (e) => {
            if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
                e.preventDefault();

                const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
                const currentScale = this.model.scale.x;
                const newScale = currentScale * scaleChange;

                const minScale = this.model.scale.x * 0.3;
                const maxScale = this.model.scale.x * 3.0;

                if (newScale >= minScale && newScale <= maxScale) {
                    this.model.scale.set(newScale);

                    const oldWidth = this.model.width / scaleChange;
                    const oldHeight = this.model.height / scaleChange;
                    const deltaWidth = this.model.width - oldWidth;
                    const deltaHeight = this.model.height - oldHeight;

                    this.model.x -= deltaWidth / 2;
                    this.model.y -= deltaHeight / 2;
                    this.updateInteractionArea();
                    this.hitTestService.markCacheDirty('scale');
                    this.saveModelPosition();
                }
            }
        }, { passive: false });

        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                console.log('[multi-monitor] renderer resize:', {
                    width: window.innerWidth,
                    height: window.innerHeight,
                    modelPosition: { x: this.model?.x, y: this.model?.y },
                    windowModelPosition: this.model ? this.modelPositionToWindowPixels() : null
                });
                this.app.renderer.resize(window.innerWidth * 2, window.innerHeight * 2);
                this.app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
                this.app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);
                this.updateInteractionArea();
                this.hitTestService.markCacheDirty('resize');
            }
        });

        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        this.model.on('rightdown', (e) => {
            e.stopPropagation();
        });
    }

    // 设置嘴部动画
    setMouthOpenY(v) {
        if (!this.model) return;

        try {
            v = Math.max(0, Math.min(v, 3.0));
            const coreModel = this.model.internalModel.coreModel;

            try {
                coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v);
            } catch (e) {}

            try {
                coreModel.setParameterValueById('ParamMouthOpenY', v);
            } catch (e) {}

            try {
                coreModel.SetParameterValue('PARAM_MOUTH_OPEN_Y', v);
            } catch (e) {}

            try {
                coreModel.SetParameterValue('ParamMouthOpenY', v);
            } catch (e) {}

        } catch (error) {
            console.error('设置嘴型参数失败:', error);
        }
    }

    // 初始化模型位置和大小
    setupInitialModelProperties(scaleMultiplier = 2.3) {
        if (!this.model || !this.app) return;

        this.model.scale.set(scaleMultiplier);

        if (this.config && this.config.ui && this.config.ui.model_position && this.config.ui.model_position.remember_position) {
            const savedPos = this.config.ui.model_position;
            const relativePosition = savedPos.display_relative || savedPos;
            if (relativePosition.x !== null && relativePosition.y !== null) {
                this.model.x = relativePosition.x * window.innerWidth;
                this.model.y = relativePosition.y * window.innerHeight;
                console.log('[multi-monitor] restored model position:', {
                    savedPosition: savedPos,
                    resolvedPosition: { x: this.model.x, y: this.model.y },
                    windowSize: { width: window.innerWidth, height: window.innerHeight }
                });
            } else {
                this.model.y = window.innerHeight * 0.8;
                this.model.x = window.innerWidth * 1.35;
            }
        } else {
            this.model.y = window.innerHeight * 0.8;
            this.model.x = window.innerWidth * 1.35;
        }

        this.clampModelToVisibleArea('initial-restore');
        this.ensureModelVisibleOnStartup();
        this.updateInteractionArea();
        this.hitTestService.markCacheDirty('initial-restore');
    }

    ensureModelVisibleOnStartup() {
        if (!this.model || typeof this.model.getBounds !== 'function') {
            return;
        }

        const bounds = this.getCurrentModelBounds();
        if (!bounds) {
            return;
        }

        const isVisible = bounds.x < window.innerWidth &&
            bounds.x + bounds.width > 0 &&
            bounds.y < window.innerHeight &&
            bounds.y + bounds.height > 0;

        if (isVisible) {
            return;
        }

        console.warn('[live2d] model restored outside viewport, applying startup recovery:', bounds);
        this.model.scale.set(this.config?.ui?.model_scale || 2.3);
        this.model.x = window.innerWidth * 1.35;
        this.model.y = window.innerHeight * 0.8;
        this.clampModelToVisibleArea('startup-recovery');
    }

    // 保存模型位置到配置文件
    saveModelPosition() {
        if (!this.model || !this.config) return;

        if (!this.config.ui || !this.config.ui.model_position || !this.config.ui.model_position.remember_position) {
            return;
        }

        this.clampModelToVisibleArea('save');

        const modelWindowPosition = this.modelPositionToWindowPixels();
        const relativeX = modelWindowPosition.x / window.innerWidth;
        const relativeY = modelWindowPosition.y / window.innerHeight;

        this.config.ui.model_position.display_relative = {
            x: relativeX,
            y: relativeY
        };
        this.config.ui.model_position.x = relativeX;
        this.config.ui.model_position.y = relativeY;

        console.log('[multi-monitor] saving model position:', {
            localPosition: { x: this.model.x, y: this.model.y },
            windowLocalPosition: modelWindowPosition,
            relativePosition: { x: relativeX, y: relativeY },
            scale: this.model.scale.x
        });

        ipcRenderer.send('save-model-position', {
            localX: modelWindowPosition.x,
            localY: modelWindowPosition.y,
            scale: this.model.scale.x
        });
    }

    async maybeTransferAcrossDisplays(pointerPosition) {
        const now = Date.now();
        if (this.crossDisplayTransferInFlight || now - this.lastCrossDisplayTransferAt < this.crossDisplayTransferCooldownMs) {
            return;
        }

        const pointerWindowPosition = this.toWindowPixels(pointerPosition);
        const direction = this.resolveCrossDisplayDirection(pointerWindowPosition);
        if (!direction) {
            return;
        }

        console.log('[multi-monitor] edge reached, requesting transfer:', {
            direction,
            pointerPosition,
            pointerWindowPosition,
            windowSize: { width: window.innerWidth, height: window.innerHeight },
            modelPosition: { x: this.model.x, y: this.model.y }
        });

        this.crossDisplayTransferInFlight = true;
        try {
            const result = await ipcRenderer.invoke('transfer-model-to-display', {
                direction,
                localPointer: {
                    x: pointerWindowPosition.x,
                    y: pointerWindowPosition.y
                }
            });

            console.log('[multi-monitor] transfer response:', result);

            if (result && result.success && result.localPointer) {
                this.model.position.set(
                    result.localPointer.x - this.dragOffset.x,
                    result.localPointer.y - this.dragOffset.y
                );
                this.clampModelToVisibleArea('transfer');
                this.updateInteractionArea();
                this.lastCrossDisplayTransferAt = Date.now();
                console.log('[multi-monitor] transfer applied in renderer:', {
                    newPointer: result.localPointer,
                    dragOffset: this.dragOffset,
                    modelPosition: { x: this.model.x, y: this.model.y }
                });
            }
        } catch (error) {
            console.warn('跨显示器迁移失败:', error);
        } finally {
            this.crossDisplayTransferInFlight = false;
        }
    }

    resolveCrossDisplayDirection(pointerPosition) {
        if (pointerPosition.x <= this.crossDisplayEdgeThreshold) {
            return 'left';
        }
        if (pointerPosition.x >= window.innerWidth - this.crossDisplayEdgeThreshold) {
            return 'right';
        }
        if (pointerPosition.y <= this.crossDisplayEdgeThreshold) {
            return 'up';
        }
        if (pointerPosition.y >= window.innerHeight - this.crossDisplayEdgeThreshold) {
            return 'down';
        }

        return null;
    }

    clampModelToVisibleArea(reason = 'unknown') {
        if (!this.model) {
            return;
        }

        const minVisibleWidth = 100;
        const minVisibleHeight = 100;
        const minX = -this.model.width + minVisibleWidth;
        const maxX = window.innerWidth - minVisibleWidth;
        const minY = -this.model.height + minVisibleHeight;
        const maxY = window.innerHeight - minVisibleHeight;

        const clampedX = Math.max(minX, Math.min(this.model.x, maxX));
        const clampedY = Math.max(minY, Math.min(this.model.y, maxY));

        if (clampedX !== this.model.x || clampedY !== this.model.y) {
            console.log('[multi-monitor] clamped model position:', {
                reason,
                before: { x: this.model.x, y: this.model.y },
                after: { x: clampedX, y: clampedY },
                bounds: { minX, maxX, minY, maxY }
            });
            this.model.position.set(clampedX, clampedY);
            this.updateInteractionArea();
        }
    }
}

module.exports = { ModelInteractionController };
