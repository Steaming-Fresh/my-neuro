const { ipcRenderer } = require('electron');
const { ModelHitDetector } = require('./model-hit-detector.js');
const { ModelLayoutManager } = require('./model-layout-manager.js');

class ModelInteractionController {
    constructor() {
        this.model = null;
        this.app = null;
        this.isDragging = false;
        this.isDraggingChat = false;
        this.dragOffset = { x: 0, y: 0 };
        this.chatDragOffset = { x: 0, y: 0 };
        this.pointerClientPosition = null;
        this.config = null;
        this.baseScale = 2.3;
        this.hitDetector = null;
        this.layoutManager = null;
    }

    init(model, app, config = null) {
        this.model = model;
        this.app = app;
        this.config = config;
        this.hitDetector = new ModelHitDetector(model, app);
        this.layoutManager = new ModelLayoutManager(config);
        this.setupInteractivity();
    }

    setupInteractivity() {
        if (!this.model || !this.app) {
            return;
        }

        this.model.interactive = true;
        this.model.containsPoint = (point) => this.containsRendererPoint(point);

        this.model.on('mousedown', (event) => {
            const point = event?.data?.global;
            if (!this.containsRendererPoint(point)) {
                return;
            }

            this.isDragging = true;
            this.dragOffset.x = point.x - this.model.x;
            this.dragOffset.y = point.y - this.model.y;
            this.setMouseIgnore(false, { forward: false });
        });

        this.model.on('mouseover', () => {
            this.setMouseIgnore(false, { forward: false });
        });

        this.model.on('mouseout', () => {
            if (!this.isDragging) {
                this.updateMouseIgnoreFromPointer();
            }
        });

        this.model.on('click', () => {
            if (!this.model?.internalModel) {
                return;
            }

            this.model.motion('Tap');
            this.model.expression();
        });

        document.addEventListener('mousemove', (event) => {
            this.pointerClientPosition = {
                x: event.clientX,
                y: event.clientY
            };

            if (this.isDragging) {
                const point = this.hitDetector.clientToRendererPoint(event.clientX, event.clientY);
                if (point) {
                    this.model.position.set(
                        point.x - this.dragOffset.x,
                        point.y - this.dragOffset.y
                    );
                }
            }

            if (this.isDraggingChat) {
                const chatContainer = document.getElementById('text-chat-container');
                if (chatContainer) {
                    chatContainer.style.left = `${event.clientX - this.chatDragOffset.x}px`;
                    chatContainer.style.top = `${event.clientY - this.chatDragOffset.y}px`;
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                void this.saveModelPosition();
                setTimeout(() => this.updateMouseIgnoreFromPointer(), 50);
            }
        });

        const chatContainer = document.getElementById('text-chat-container');
        if (chatContainer) {
            chatContainer.addEventListener('mousedown', (event) => {
                if (event.target === chatContainer || event.target.id === 'chat-messages') {
                    this.isDraggingChat = true;
                    this.chatDragOffset.x = event.clientX - chatContainer.getBoundingClientRect().left;
                    this.chatDragOffset.y = event.clientY - chatContainer.getBoundingClientRect().top;
                    this.setMouseIgnore(false, { forward: false });
                    event.preventDefault();
                }
            });
        }

        document.addEventListener('mouseup', () => {
            if (this.isDraggingChat) {
                this.isDraggingChat = false;
                setTimeout(() => this.updateMouseIgnoreFromPointer(), 50);
            }
        });

        window.addEventListener('wheel', (event) => {
            if (!this.containsClientPoint(event.clientX, event.clientY)) {
                return;
            }

            event.preventDefault();

            const previousWidth = this.model.width;
            const previousHeight = this.model.height;
            const scaleChange = event.deltaY > 0 ? 0.92 : 1.08;
            const minScale = this.baseScale * 0.45;
            const maxScale = this.baseScale * 3.2;
            const newScale = this.clamp(this.model.scale.x * scaleChange, minScale, maxScale);

            this.model.scale.set(newScale);
            this.model.x -= (this.model.width - previousWidth) / 2;
            this.model.y -= (this.model.height - previousHeight) / 2;

            void this.saveModelPosition();
        }, { passive: false });

        window.addEventListener('resize', () => {
            if (this.app?.renderer) {
                this.app.renderer.resize(window.innerWidth, window.innerHeight);
            }
        });

        window.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            return false;
        });

        this.model.on('rightdown', (event) => {
            event.stopPropagation();
        });
    }

    containsRendererPoint(point) {
        return this.hitDetector ? this.hitDetector.containsRendererPoint(point) : false;
    }

    containsClientPoint(clientX, clientY) {
        return this.hitDetector ? this.hitDetector.containsClientPoint(clientX, clientY) : false;
    }

    isInteractiveClientPoint(clientX, clientY) {
        return this.containsClientPoint(clientX, clientY) || this.isPointInChat(clientX, clientY);
    }

    isPointInChat(clientX, clientY) {
        const chatContainer = document.getElementById('text-chat-container');
        if (!chatContainer || window.getComputedStyle(chatContainer).display === 'none') {
            return false;
        }

        const rect = chatContainer.getBoundingClientRect();
        return clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom;
    }

    updateMouseIgnoreFromPointer() {
        if (!this.pointerClientPosition || this.isDragging || this.isDraggingChat) {
            return;
        }

        const shouldIgnore = !this.isInteractiveClientPoint(
            this.pointerClientPosition.x,
            this.pointerClientPosition.y
        );

        this.setMouseIgnore(shouldIgnore, { forward: true });
    }

    setMouseIgnore(ignore, options = { forward: true }) {
        ipcRenderer.send('set-ignore-mouse-events', { ignore, options });
    }

    async setupInitialModelProperties(scaleMultiplier = 2.3) {
        if (!this.model) {
            return;
        }

        this.baseScale = Number.isFinite(scaleMultiplier) && scaleMultiplier > 0 ? scaleMultiplier : 2.3;

        if (this.layoutManager) {
            await this.layoutManager.applyInitialLayout(this.model, this.baseScale);
        } else {
            this.model.scale.set(this.baseScale);
            this.model.x = Math.max((window.innerWidth - this.model.width) / 2, 0);
            this.model.y = Math.max((window.innerHeight - this.model.height) / 2, 0);
        }
    }

    async saveModelPosition() {
        if (!this.model || !this.config || !this.shouldRememberPosition()) {
            return;
        }

        const snapshot = await this.layoutManager?.buildLayoutSnapshot(this.model);
        if (!snapshot) {
            return;
        }

        if (!this.config.ui) {
            this.config.ui = {};
        }
        if (!this.config.ui.model_position) {
            this.config.ui.model_position = {
                x: null,
                y: null,
                remember_position: true
            };
        }

        this.config.ui.model_position.x = snapshot.legacyPosition.x;
        this.config.ui.model_position.y = snapshot.legacyPosition.y;
        this.config.ui.model_scale = snapshot.scale;
        this.config.ui.model_layout = snapshot.layout;

        ipcRenderer.send('save-model-position', {
            x: snapshot.legacyPosition.x,
            y: snapshot.legacyPosition.y,
            scale: snapshot.scale,
            layout: snapshot.layout
        });
    }

    shouldRememberPosition() {
        return this.config?.ui?.model_position?.remember_position !== false;
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    setMouthOpenY(v) {
        if (!this.model) {
            return;
        }

        try {
            v = Math.max(0, Math.min(v, 3.0));
            const coreModel = this.model.internalModel.coreModel;

            try {
                coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v);
            } catch (error) {}

            try {
                coreModel.setParameterValueById('ParamMouthOpenY', v);
            } catch (error) {}

            try {
                coreModel.SetParameterValue('PARAM_MOUTH_OPEN_Y', v);
            } catch (error) {}

            try {
                coreModel.SetParameterValue('ParamMouthOpenY', v);
            } catch (error) {}
        } catch (error) {
            console.error('设置嘴型参数失败:', error);
        }
    }
}

module.exports = { ModelInteractionController };
