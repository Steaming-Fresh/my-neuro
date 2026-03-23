class WindowPlacementService {
    constructor(displayTopologyService) {
        this.displayTopologyService = displayTopologyService;
    }

    buildWindowBounds(display) {
        const workArea = display.workArea;
        return {
            x: workArea.x,
            y: workArea.y,
            width: workArea.width,
            height: workArea.height
        };
    }

    resolveInitialDisplay(savedPosition) {
        if (savedPosition) {
            console.log('[multi-monitor] resolving initial display from saved position:', savedPosition);
            const displayById = this.displayTopologyService.getDisplayById(savedPosition.display_id);
            if (displayById) {
                console.log('[multi-monitor] initial display resolved by display_id:', displayById.id);
                return displayById;
            }

            const globalPoint = savedPosition.desktop_global;
            if (globalPoint && Number.isFinite(globalPoint.x) && Number.isFinite(globalPoint.y)) {
                const displayByPoint = this.displayTopologyService.getDisplayMatchingGlobalPoint(globalPoint);
                if (displayByPoint) {
                    console.log('[multi-monitor] initial display resolved by desktop_global:', {
                        point: globalPoint,
                        displayId: displayByPoint.id
                    });
                    return displayByPoint;
                }
            }
        }

        const fallbackDisplay = this.displayTopologyService.getDisplayNearestPoint({ x: 0, y: 0 });
        console.log('[multi-monitor] initial display falling back to nearest point (0,0):', fallbackDisplay?.id);
        return fallbackDisplay;
    }

    moveWindowToDisplay(win, display) {
        const targetBounds = this.buildWindowBounds(display);
        console.log('[multi-monitor] moving window to display:', {
            displayId: display.id,
            targetBounds
        });
        win.setBounds(targetBounds);
        return targetBounds;
    }

    transferWindowToDisplay(win, { direction, localPointer }) {
        const currentDisplay = this.displayTopologyService.getDisplayForWindow(win);
        const currentBounds = win.getBounds();
        const globalPointer = {
            x: currentBounds.x + localPointer.x,
            y: currentBounds.y + localPointer.y
        };

        console.log('[multi-monitor] transfer request:', {
            direction,
            localPointer,
            globalPointer,
            currentDisplayId: currentDisplay?.id,
            currentBounds
        });

        let targetDisplay = this.displayTopologyService.findAdjacentDisplay(currentDisplay, direction, globalPointer);
        if (!targetDisplay) {
            targetDisplay = this.displayTopologyService.getDisplayMatchingGlobalPoint(globalPointer)
                || this.displayTopologyService.getDisplayNearestPoint(globalPointer);
            console.log('[multi-monitor] transfer fallback target display:', targetDisplay?.id);
        }

        if (!targetDisplay || targetDisplay.id === currentDisplay.id) {
            console.log('[multi-monitor] transfer skipped:', {
                targetDisplayId: targetDisplay?.id,
                currentDisplayId: currentDisplay?.id
            });
            return {
                success: false,
                sameDisplay: true,
                display: this.serializeDisplay(currentDisplay),
                localPointer
            };
        }

        const newBounds = this.moveWindowToDisplay(win, targetDisplay);
        const remappedLocalPointer = {
            x: globalPointer.x - newBounds.x,
            y: globalPointer.y - newBounds.y
        };

        console.log('[multi-monitor] transfer applied:', {
            fromDisplayId: currentDisplay.id,
            toDisplayId: targetDisplay.id,
            newBounds,
            remappedLocalPointer
        });

        return {
            success: true,
            display: this.serializeDisplay(targetDisplay),
            localPointer: remappedLocalPointer
        };
    }

    serializeDisplay(display) {
        if (!display) {
            return null;
        }

        return {
            id: display.id,
            bounds: { ...display.bounds },
            workArea: { ...display.workArea },
            scaleFactor: display.scaleFactor
        };
    }

    buildModelPositionPayload(win, modelPosition) {
        const display = this.displayTopologyService.getDisplayForWindow(win);
        const displayArea = display.workArea;
        const globalX = win.getBounds().x + modelPosition.localX;
        const globalY = win.getBounds().y + modelPosition.localY;

        const payload = {
            remember_position: true,
            display_id: display.id,
            display_relative: {
                x: displayArea.width === 0 ? 0 : modelPosition.localX / displayArea.width,
                y: displayArea.height === 0 ? 0 : modelPosition.localY / displayArea.height
            },
            desktop_global: {
                x: globalX,
                y: globalY
            },
            display_snapshot: {
                x: displayArea.x,
                y: displayArea.y,
                width: displayArea.width,
                height: displayArea.height
            },
            scale: modelPosition.scale
        };

        console.log('[multi-monitor] model position payload:', payload);
        return payload;
    }
}

module.exports = { WindowPlacementService };
