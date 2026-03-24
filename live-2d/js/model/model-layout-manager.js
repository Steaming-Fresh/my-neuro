const { ipcRenderer } = require('electron');

class ModelLayoutManager {
    constructor(config) {
        this.config = config;
    }

    async applyInitialLayout(model, initialScale) {
        if (!model) {
            return;
        }

        if (Number.isFinite(initialScale) && initialScale > 0) {
            model.scale.set(initialScale);
        }

        const displayInfo = await this.getDisplayInfo();
        const restored = this.restoreSavedLayout(model, displayInfo);

        if (!restored) {
            this.applyDefaultCenterLayout(model, displayInfo);
        }
    }

    async buildLayoutSnapshot(model) {
        if (!model) {
            return null;
        }

        const displayInfo = await this.getDisplayInfo();
        const modelCenter = this.getModelCenter(model);
        const targetDisplay = this.findDisplayForPoint(modelCenter, displayInfo);

        if (!targetDisplay) {
            return null;
        }

        const virtualBounds = displayInfo.virtualBounds;
        const workAreaLeft = targetDisplay.workArea.x - virtualBounds.x;
        const workAreaTop = targetDisplay.workArea.y - virtualBounds.y;

        return {
            layout: {
                version: 1,
                anchor_type: 'center',
                reference_space: 'display-workarea',
                display_id: targetDisplay.id,
                anchor_x_ratio: this.clamp((modelCenter.x - workAreaLeft) / targetDisplay.workArea.width, 0, 1),
                anchor_y_ratio: this.clamp((modelCenter.y - workAreaTop) / targetDisplay.workArea.height, 0, 1),
                saved_display_width: targetDisplay.workArea.width,
                saved_display_height: targetDisplay.workArea.height,
                scale: model.scale.x
            },
            legacyPosition: {
                x: window.innerWidth ? model.x / window.innerWidth : 0,
                y: window.innerHeight ? model.y / window.innerHeight : 0
            },
            scale: model.scale.x
        };
    }

    restoreSavedLayout(model, displayInfo) {
        const layout = this.config?.ui?.model_layout;

        if (!this.isValidLayout(layout)) {
            return false;
        }

        const displays = displayInfo.displays || [];
        const targetDisplay = displays.find((display) => String(display.id) === String(layout.display_id))
            || displays.find((display) => String(display.id) === String(displayInfo.primaryDisplayId))
            || displays[0];

        if (!targetDisplay) {
            return false;
        }

        if (Number.isFinite(layout.scale) && layout.scale > 0) {
            model.scale.set(layout.scale);
        }

        const virtualBounds = displayInfo.virtualBounds;
        const centerX = (targetDisplay.workArea.x - virtualBounds.x) + (targetDisplay.workArea.width * layout.anchor_x_ratio);
        const centerY = (targetDisplay.workArea.y - virtualBounds.y) + (targetDisplay.workArea.height * layout.anchor_y_ratio);

        model.x = centerX - (model.width / 2);
        model.y = centerY - (model.height / 2);

        return true;
    }

    applyDefaultCenterLayout(model, displayInfo) {
        const displays = displayInfo.displays || [];
        const primaryDisplay = displays.find((display) => String(display.id) === String(displayInfo.primaryDisplayId))
            || displays[0];

        if (!primaryDisplay) {
            model.x = Math.max((window.innerWidth - model.width) / 2, 0);
            model.y = Math.max((window.innerHeight - model.height) / 2, 0);
            return;
        }

        const virtualBounds = displayInfo.virtualBounds;
        const centerX = (primaryDisplay.workArea.x - virtualBounds.x) + (primaryDisplay.workArea.width / 2);
        const centerY = (primaryDisplay.workArea.y - virtualBounds.y) + (primaryDisplay.workArea.height / 2);

        model.x = centerX - (model.width / 2);
        model.y = centerY - (model.height / 2);
    }

    async getDisplayInfo() {
        try {
            const info = await ipcRenderer.invoke('get-display-info');
            if (info && Array.isArray(info.displays) && info.virtualBounds) {
                return info;
            }
        } catch (error) {
            console.warn('获取显示器信息失败，回退到窗口尺寸布局:', error);
        }

        return {
            primaryDisplayId: 'window',
            virtualBounds: {
                x: 0,
                y: 0,
                width: window.innerWidth,
                height: window.innerHeight
            },
            displays: [
                {
                    id: 'window',
                    bounds: {
                        x: 0,
                        y: 0,
                        width: window.innerWidth,
                        height: window.innerHeight
                    },
                    workArea: {
                        x: 0,
                        y: 0,
                        width: window.innerWidth,
                        height: window.innerHeight
                    }
                }
            ]
        };
    }

    findDisplayForPoint(point, displayInfo) {
        const displays = displayInfo.displays || [];

        if (!displays.length) {
            return null;
        }

        const containingDisplay = displays.find((display) => this.pointInRect(point, {
            x: display.workArea.x - displayInfo.virtualBounds.x,
            y: display.workArea.y - displayInfo.virtualBounds.y,
            width: display.workArea.width,
            height: display.workArea.height
        }));

        if (containingDisplay) {
            return containingDisplay;
        }

        let nearestDisplay = displays[0];
        let nearestDistance = Number.POSITIVE_INFINITY;

        for (const display of displays) {
            const rect = {
                x: display.workArea.x - displayInfo.virtualBounds.x,
                y: display.workArea.y - displayInfo.virtualBounds.y,
                width: display.workArea.width,
                height: display.workArea.height
            };
            const distance = this.distanceToRect(point, rect);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestDisplay = display;
            }
        }

        return nearestDisplay;
    }

    getModelCenter(model) {
        return {
            x: model.x + (model.width / 2),
            y: model.y + (model.height / 2)
        };
    }

    pointInRect(point, rect) {
        return point.x >= rect.x &&
            point.x <= rect.x + rect.width &&
            point.y >= rect.y &&
            point.y <= rect.y + rect.height;
    }

    distanceToRect(point, rect) {
        const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
        const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
        return Math.sqrt((dx * dx) + (dy * dy));
    }

    isValidLayout(layout) {
        return !!layout &&
            Number.isFinite(layout.anchor_x_ratio) &&
            Number.isFinite(layout.anchor_y_ratio) &&
            layout.anchor_x_ratio >= 0 &&
            layout.anchor_x_ratio <= 1 &&
            layout.anchor_y_ratio >= 0 &&
            layout.anchor_y_ratio <= 1;
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

module.exports = { ModelLayoutManager };
