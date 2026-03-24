class ModelHitDetector {
    constructor(model, app, options = {}) {
        this.model = model;
        this.app = app;
        this.alphaThreshold = options.alphaThreshold ?? 24;
        this.sampleRadius = options.sampleRadius ?? 2;
        this.boundsPadding = options.boundsPadding ?? 10;
        this.readBuffer = null;
    }

    update(model, app) {
        this.model = model;
        this.app = app;
    }

    containsRendererPoint(point) {
        if (!this.model || !this.app || !point || !this.model.visible) {
            return false;
        }

        if (!this.isWithinModelBounds(point)) {
            return false;
        }

        return this.readAlphaAtPoint(point);
    }

    containsClientPoint(clientX, clientY) {
        const rendererPoint = this.clientToRendererPoint(clientX, clientY);
        if (!rendererPoint) {
            return false;
        }

        return this.containsRendererPoint(rendererPoint);
    }

    clientToRendererPoint(clientX, clientY) {
        const view = this.app?.renderer?.view;
        const screen = this.app?.screen;

        if (!view || !screen) {
            return null;
        }

        const rect = view.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return null;
        }

        return {
            x: (clientX - rect.left) * (screen.width / rect.width),
            y: (clientY - rect.top) * (screen.height / rect.height)
        };
    }

    isWithinModelBounds(point) {
        const bounds = this.model.getBounds();
        const padding = this.boundsPadding;

        return point.x >= bounds.x - padding &&
            point.x <= bounds.x + bounds.width + padding &&
            point.y >= bounds.y - padding &&
            point.y <= bounds.y + bounds.height + padding;
    }

    readAlphaAtPoint(point) {
        const renderer = this.app?.renderer;
        const gl = renderer?.gl;
        const view = renderer?.view;
        const screen = this.app?.screen;

        if (!renderer || !gl || !view || !screen) {
            return false;
        }

        const scaleX = view.width / Math.max(screen.width, 1);
        const scaleY = view.height / Math.max(screen.height, 1);
        const pixelX = Math.round(point.x * scaleX);
        const pixelY = Math.round(view.height - 1 - (point.y * scaleY));
        const radiusX = Math.max(0, Math.round(this.sampleRadius * scaleX));
        const radiusY = Math.max(0, Math.round(this.sampleRadius * scaleY));

        const left = this.clamp(pixelX - radiusX, 0, Math.max(view.width - 1, 0));
        const right = this.clamp(pixelX + radiusX, 0, Math.max(view.width - 1, 0));
        const top = this.clamp(pixelY - radiusY, 0, Math.max(view.height - 1, 0));
        const bottom = this.clamp(pixelY + radiusY, 0, Math.max(view.height - 1, 0));

        const width = right - left + 1;
        const height = bottom - top + 1;

        if (width <= 0 || height <= 0) {
            return false;
        }

        const bufferLength = width * height * 4;
        if (!this.readBuffer || this.readBuffer.length !== bufferLength) {
            this.readBuffer = new Uint8Array(bufferLength);
        }

        try {
            gl.readPixels(left, top, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.readBuffer);
        } catch (error) {
            console.warn('读取 Live2D 命中像素失败:', error);
            return false;
        }

        for (let index = 3; index < this.readBuffer.length; index += 4) {
            if (this.readBuffer[index] >= this.alphaThreshold) {
                return true;
            }
        }

        return false;
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

module.exports = { ModelHitDetector };
