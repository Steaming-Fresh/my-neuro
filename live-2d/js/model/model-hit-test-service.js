class ModelHitTestService {
    constructor(config = null) {
        this.config = config;
        this.model = null;
        this.app = null;
        this.fallbackContainsPoint = null;
        this.pixelCache = null;
        this.cacheDirty = true;
    }

    init(model, app, config = null) {
        this.model = model;
        this.app = app;
        if (config) {
            this.config = config;
        }
        this.markCacheDirty('init');
    }

    setConfig(config) {
        this.config = config;
    }

    setFallbackContainsPoint(fn) {
        this.fallbackContainsPoint = typeof fn === 'function' ? fn : null;
    }

    markCacheDirty(reason = 'unknown') {
        this.cacheDirty = true;
        this.lastDirtyReason = reason;
    }

    containsInteractivePoint(point, { includeChat = true } = {}) {
        if (includeChat && this.isPointInChat(point)) {
            return true;
        }

        return this.isPointInModel(point);
    }

    isPointInModel(point) {
        if (!this.isValidPoint(point)) {
            return false;
        }

        const bounds = this.getModelBounds();
        if (!bounds || !this.pointWithinBounds(point, bounds)) {
            return false;
        }

        if (!this.isAdaptiveHitTestEnabled()) {
            return this.fallbackHitTest(point, bounds);
        }

        const cache = this.getPixelCache(bounds);
        if (!cache) {
            return this.fallbackHitTest(point, bounds);
        }

        return this.sampleAlpha(cache, point, bounds);
    }

    isAdaptiveHitTestEnabled() {
        return this.config?.ui?.adaptive_hit_test_enabled !== false;
    }

    isDebugEnabled() {
        return this.config?.ui?.hit_test_debug_enabled === true;
    }

    getAlphaThreshold() {
        const value = Number(this.config?.ui?.hit_test_alpha_threshold);
        if (Number.isFinite(value)) {
            return Math.max(0, Math.min(255, Math.round(value)));
        }
        return 32;
    }

    getSampleRadius() {
        const value = Number(this.config?.ui?.hit_test_sample_radius);
        if (Number.isFinite(value)) {
            return Math.max(0, Math.min(4, Math.round(value)));
        }
        return 1;
    }

    getCacheTTL() {
        const value = Number(this.config?.ui?.hit_test_cache_ttl_ms);
        if (Number.isFinite(value)) {
            return Math.max(16, Math.round(value));
        }
        return 120;
    }

    getModelBounds() {
        if (!this.model || typeof this.model.getBounds !== 'function') {
            return null;
        }

        try {
            const bounds = this.model.getBounds();
            if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
                return null;
            }

            return {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            };
        } catch (error) {
            if (this.isDebugEnabled()) {
                console.warn('[hit-test] failed to read model bounds:', error);
            }
            return null;
        }
    }

    getPixelCache(bounds) {
        const now = Date.now();
        const shouldRebuild = !this.pixelCache ||
            this.cacheDirty ||
            now - this.pixelCache.builtAt > this.getCacheTTL() ||
            this.shouldRebuildForBounds(bounds, this.pixelCache.sourceBounds);

        if (shouldRebuild) {
            this.pixelCache = this.buildPixelCache(bounds);
            this.cacheDirty = false;
        }

        return this.pixelCache;
    }

    shouldRebuildForBounds(currentBounds, cachedBounds) {
        if (!currentBounds || !cachedBounds) {
            return true;
        }

        return Math.abs(currentBounds.width - cachedBounds.width) > 1 ||
            Math.abs(currentBounds.height - cachedBounds.height) > 1;
    }

    buildPixelCache(bounds) {
        const renderer = this.app?.renderer;
        const extract = renderer?.plugins?.extract || renderer?.extract;
        const pixi = globalThis.PIXI;

        if (!renderer || !extract || !pixi || !pixi.RenderTexture || !pixi.Matrix) {
            if (this.isDebugEnabled()) {
                console.warn('[hit-test] extract plugin or PIXI helpers unavailable, falling back');
            }
            return null;
        }

        const width = Math.max(1, Math.ceil(bounds.width));
        const height = Math.max(1, Math.ceil(bounds.height));
        let renderTexture = null;

        try {
            renderTexture = pixi.RenderTexture.create({ width, height, resolution: 1 });
            const transform = new pixi.Matrix();
            transform.translate(-bounds.x, -bounds.y);

            try {
                renderer.render(this.model, {
                    renderTexture,
                    clear: true,
                    transform
                });
            } catch (modernRenderError) {
                renderer.render(this.model, renderTexture, true, transform);
            }

            const pixels = extract.pixels(renderTexture);
            return {
                width,
                height,
                pixels,
                builtAt: Date.now(),
                sourceBounds: {
                    width: bounds.width,
                    height: bounds.height
                }
            };
        } catch (error) {
            if (this.isDebugEnabled()) {
                console.warn('[hit-test] failed to build pixel cache:', error);
            }
            return null;
        } finally {
            if (renderTexture && typeof renderTexture.destroy === 'function') {
                renderTexture.destroy(true);
            }
        }
    }

    sampleAlpha(cache, point, bounds) {
        const normalizedX = (point.x - bounds.x) / bounds.width;
        const normalizedY = (point.y - bounds.y) / bounds.height;

        if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
            return this.fallbackHitTest(point, bounds);
        }

        const pixelX = Math.floor(normalizedX * cache.width);
        const pixelY = Math.floor(normalizedY * cache.height);
        const radius = this.getSampleRadius();
        const threshold = this.getAlphaThreshold();

        for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
            for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
                const sampleX = pixelX + offsetX;
                const sampleY = pixelY + offsetY;
                if (sampleX < 0 || sampleY < 0 || sampleX >= cache.width || sampleY >= cache.height) {
                    continue;
                }

                const alpha = this.getPixelAlpha(cache, sampleX, sampleY);
                if (alpha >= threshold) {
                    return true;
                }
            }
        }

        return false;
    }

    getPixelAlpha(cache, x, y) {
        const index = (y * cache.width + x) * 4 + 3;
        return cache.pixels[index] || 0;
    }

    fallbackHitTest(point, bounds = null) {
        const resolvedBounds = bounds || this.getModelBounds();
        if (!resolvedBounds || !this.pointWithinBounds(point, resolvedBounds)) {
            return false;
        }

        if (this.fallbackContainsPoint) {
            try {
                return !!this.fallbackContainsPoint(point);
            } catch (error) {
                if (this.isDebugEnabled()) {
                    console.warn('[hit-test] fallback containsPoint failed:', error);
                }
            }
        }

        return true;
    }

    pointWithinBounds(point, bounds) {
        return point.x >= bounds.x &&
            point.x <= bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y <= bounds.y + bounds.height;
    }

    isValidPoint(point) {
        return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
    }

    isPointInChat(point) {
        const chatContainer = document.getElementById('text-chat-container');
        const view = this.app?.renderer?.view;
        if (!chatContainer || !view) {
            return false;
        }

        const canvasRect = view.getBoundingClientRect();
        const chatRect = chatContainer.getBoundingClientRect();
        if (!canvasRect.width || !canvasRect.height) {
            return false;
        }

        const scaleX = view.width / canvasRect.width;
        const scaleY = view.height / canvasRect.height;
        const left = (chatRect.left - canvasRect.left) * scaleX;
        const right = (chatRect.right - canvasRect.left) * scaleX;
        const top = (chatRect.top - canvasRect.top) * scaleY;
        const bottom = (chatRect.bottom - canvasRect.top) * scaleY;

        return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    }
}

module.exports = { ModelHitTestService };
