class DisplayTopologyService {
    constructor(screen) {
        this.screen = screen;
    }

    getAllDisplays() {
        const displays = this.screen.getAllDisplays();
        console.log('[multi-monitor] detected displays:', displays.map((display) => ({
            id: display.id,
            bounds: display.bounds,
            workArea: display.workArea,
            scaleFactor: display.scaleFactor
        })));
        return displays;
    }

    getDisplayById(displayId) {
        if (!Number.isFinite(displayId)) {
            return null;
        }

        return this.getAllDisplays().find((display) => display.id === displayId) || null;
    }

    getDisplayNearestPoint(point) {
        return this.screen.getDisplayNearestPoint(point);
    }

    getDisplayMatchingGlobalPoint(point) {
        return this.getAllDisplays().find((display) => {
            const area = display.workArea;
            return point.x >= area.x &&
                point.x < area.x + area.width &&
                point.y >= area.y &&
                point.y < area.y + area.height;
        }) || null;
    }

    getDisplayForWindow(win) {
        const bounds = win.getBounds();
        const centerPoint = {
            x: bounds.x + Math.floor(bounds.width / 2),
            y: bounds.y + Math.floor(bounds.height / 2)
        };

        const display = this.getDisplayNearestPoint(centerPoint);
        console.log('[multi-monitor] resolved window display:', {
            windowBounds: bounds,
            centerPoint,
            displayId: display?.id,
            workArea: display?.workArea
        });
        return display;
    }

    findAdjacentDisplay(currentDisplay, direction, globalPoint) {
        if (!currentDisplay || !direction) {
            return null;
        }

        const currentArea = currentDisplay.workArea;
        const candidates = this.getAllDisplays().filter((display) => display.id !== currentDisplay.id);

        const overlapsOnYAxis = (display) => {
            const area = display.workArea;
            return area.y < currentArea.y + currentArea.height && area.y + area.height > currentArea.y;
        };

        const overlapsOnXAxis = (display) => {
            const area = display.workArea;
            return area.x < currentArea.x + currentArea.width && area.x + area.width > currentArea.x;
        };

        const directionCandidates = candidates.filter((display) => {
            const area = display.workArea;

            if (direction === 'left') {
                return area.x + area.width <= currentArea.x && overlapsOnYAxis(display);
            }
            if (direction === 'right') {
                return area.x >= currentArea.x + currentArea.width && overlapsOnYAxis(display);
            }
            if (direction === 'up') {
                return area.y + area.height <= currentArea.y && overlapsOnXAxis(display);
            }
            if (direction === 'down') {
                return area.y >= currentArea.y + currentArea.height && overlapsOnXAxis(display);
            }

            return false;
        });

        if (directionCandidates.length === 0) {
            console.log('[multi-monitor] no adjacent display candidates:', {
                currentDisplayId: currentDisplay.id,
                direction,
                globalPoint
            });
            return null;
        }

        const distanceForDirection = (display) => {
            const area = display.workArea;

            if (direction === 'left') {
                return currentArea.x - (area.x + area.width);
            }
            if (direction === 'right') {
                return area.x - (currentArea.x + currentArea.width);
            }
            if (direction === 'up') {
                return currentArea.y - (area.y + area.height);
            }
            return area.y - (currentArea.y + currentArea.height);
        };

        const sortedCandidates = directionCandidates
            .map((display) => ({
                display,
                distance: Math.abs(distanceForDirection(display)),
                proximity: Math.hypot(
                    globalPoint.x - (display.workArea.x + Math.floor(display.workArea.width / 2)),
                    globalPoint.y - (display.workArea.y + Math.floor(display.workArea.height / 2))
                )
            }))
            .sort((a, b) => a.distance - b.distance || a.proximity - b.proximity);

        const selectedDisplay = sortedCandidates[0].display;
        console.log('[multi-monitor] adjacent display candidates:', sortedCandidates.map((candidate) => ({
            id: candidate.display.id,
            distance: candidate.distance,
            proximity: candidate.proximity,
            workArea: candidate.display.workArea
        })));
        console.log('[multi-monitor] selected adjacent display:', {
            currentDisplayId: currentDisplay.id,
            direction,
            globalPoint,
            targetDisplayId: selectedDisplay?.id
        });

        return selectedDisplay;
    }
}

module.exports = { DisplayTopologyService };
