const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { HttpServer } = require('./js/services/http-server')
const { ModelPathUpdater } = require('./js/model/model-path-updater')
const { ShortcutManager } = require('./js/shortcut-manager')
const { DisplayTopologyService } = require('./js/main/display-topology-service')
const { WindowPlacementService } = require('./js/main/window-placement-service')
const screenshot = require('screenshot-desktop');

// 添加配置文件路径
const configPath = path.join(app.getAppPath(), 'config.json');
const displayTopologyService = new DisplayTopologyService(screen);
const windowPlacementService = new WindowPlacementService(displayTopologyService);

// Live2D模型优先级配置（Python程序会修改这个列表来切换模型）
const priorityFolders = ['肥牛', 'Hiyouri', 'Default', 'Main'];


function ensureTopMost(win) {
    if (!win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(true, 'screen-saver')
    }
}

function loadSavedModelPosition() {
    try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return configData?.ui?.model_position || null;
    } catch (error) {
        return null;
    }
}

function createWindow () {
    const savedModelPosition = loadSavedModelPosition()
    const initialDisplay = windowPlacementService.resolveInitialDisplay(savedModelPosition)
    const initialBounds = windowPlacementService.buildWindowBounds(initialDisplay)
    const win = new BrowserWindow({
        width: initialBounds.width,
        height: initialBounds.height,
        x: initialBounds.x,
        y: initialBounds.y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        focusable: true,
        type: 'desktop',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            zoomFactor: 1.0,
            enableWebSQL: true
        },
        resizable: true,
        movable: true,
        skipTaskbar: true,
        maximizable: false,
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setMenu(null)
    win.loadFile('index.html')
    win.on('minimize', (event) => {
        event.preventDefault()
        win.restore()
    })
    win.on('will-move', (event, newBounds) => {
        const currentDisplay = displayTopologyService.getDisplayForWindow(win)
        const workArea = currentDisplay.workArea
        if (newBounds.x < workArea.x || newBounds.y < workArea.y || 
            newBounds.x + newBounds.width > workArea.x + workArea.width || 
            newBounds.y + newBounds.height > workArea.y + workArea.height) {
            event.preventDefault()
        }
    })
    win.on('blur', () => {
        ensureTopMost(win)
    })
    setInterval(() => {
        ensureTopMost(win)
    }, 1000)
    
    
    return win
}

// 在主进程启动时调用
app.whenReady().then(() => {
    // 在创建窗口前先更新Live2D模型路径
    const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
    modelPathUpdater.update();

    const mainWindow = createWindow();

    // 启动 HTTP API 服务器
    const httpServer = new HttpServer();
    httpServer.start();

    // 注册全局快捷键
    const shortcutManager = new ShortcutManager();
    shortcutManager.registerAll();
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

ipcMain.on('window-move', (event, { mouseX, mouseY }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const [currentX, currentY] = win.getPosition()
    const currentDisplay = displayTopologyService.getDisplayForWindow(win)
    const workArea = currentDisplay.workArea
    let newX = currentX + mouseX
    let newY = currentY + mouseY
    newX = Math.max(workArea.x - win.getBounds().width + 100, Math.min(newX, workArea.x + workArea.width - 100))
    newY = Math.max(workArea.y - win.getBounds().height + 100, Math.min(newY, workArea.y + workArea.height - 100))
    win.setPosition(newX, newY)
})

ipcMain.handle('transfer-model-to-display', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return windowPlacementService.transferWindowToDisplay(win, payload)
})

ipcMain.on('set-ignore-mouse-events', (event, { ignore, options }) => {
    BrowserWindow.fromWebContents(event.sender).setIgnoreMouseEvents(ignore, options)
})

ipcMain.on('request-top-most', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setAlwaysOnTop(true, 'screen-saver')
})

// 添加保存配置的IPC处理器
ipcMain.handle('save-config', async (event, configData) => {
    try {
        // 创建备份
        if (fs.existsSync(configPath)) {
            const backupPath = `${configPath}.bak`;
            fs.copyFileSync(configPath, backupPath);
        }

        // 保存新配置
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

        // 通知用户需要重启应用
        const result = await dialog.showMessageBox({
            type: 'info',
            title: '配置已保存',
            message: '配置已成功保存',
            detail: '需要重启应用以应用新配置。现在重启应用吗？',
            buttons: ['是', '否'],
            defaultId: 0
        });

        // 如果用户选择重启
        if (result.response === 0) {
            app.relaunch();
            app.exit();
        }

        return { success: true };
    } catch (error) {
        console.error('保存配置失败:', error);
        return { success: false, error: error.message };
    }
});

// 修改获取配置的IPC处理器，假设配置文件总是存在
ipcMain.handle('get-config', async (event) => {
    try {
        const configData = fs.readFileSync(configPath, 'utf8');
        return { success: true, config: JSON.parse(configData) };
    } catch (error) {
        console.error('获取配置失败:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('take-screenshot', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
        // 截图前隐藏皮套窗口，截完再恢复，避免皮套出现在截图里
        win.setOpacity(0);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 1. 获取系统识别到的所有物理显示器
        //TO DO 目前截图一次大约需要250ms，此处可以加一个系统显示器信息缓存，能够省下50ms截图时间开销
        const displays = await screenshot.listDisplays();

        // 2. 计算当前鼠标所在的逻辑屏幕索引
        const cursorPoint = screen.getCursorScreenPoint();
        const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

        // 3. 对 Electron 识别的屏幕按 X 轴坐标排序 (bounds.x)
        const electronDisplays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x);
        const targetIndex = electronDisplays.findIndex(d => d.id === currentDisplay.id);

        // 对screenshot-desktop原生库识别的屏幕按 X 轴坐标排序 (left)，以确保索引一致
        const nativeDisplays = displays.sort((a, b) => (a.left || 0) - (b.left || 0));

        // 越界防御检查
        if (targetIndex >= nativeDisplays.length) {
            throw new Error(`屏幕索引越界：鼠标在 Index ${targetIndex}，但原生只检测到 ${nativeDisplays.length} 个屏幕`);
        }

        const targetNativeDisplay = nativeDisplays[targetIndex];

        // 4. 执行截图
        const imgBuffer = await screenshot({
            screen: targetNativeDisplay.id,
            format: 'jpg'
        });

        // 5. 返回结果 (Base64)
        return imgBuffer.toString('base64');

    } catch (error) {
        console.error('截图错误:', error)
        throw error;
    } finally {
        win.setOpacity(1);
    }
});

// 添加IPC处理器，允许从渲染进程手动更新模型
ipcMain.handle('update-live2d-model', async (event) => {
    try {
        // 调用更新模型的函数
        const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
        modelPathUpdater.update();

        // 通知渲染进程需要重新加载以应用新模型
        const win = BrowserWindow.fromWebContents(event.sender)
        win.reload()

        return { success: true, message: '模型已更新，页面将重新加载' }
    } catch (error) {
        console.error('手动更新模型时出错:', error)
        return { success: false, message: `更新失败: ${error.message}` }
    }
})

// 添加切换Live2D模型的IPC处理器
ipcMain.handle('switch-live2d-model', async (event, modelName) => {
    try {
        console.log(`切换模型到: ${modelName}`);

        // 更新priorityFolders，将选中的模型放在第一位
        const index = priorityFolders.indexOf(modelName);
        if (index > 0) {
            // 如果模型已存在，移到第一位
            priorityFolders.splice(index, 1);
            priorityFolders.unshift(modelName);
        } else if (index === -1) {
            // 如果模型不在列表中，添加到第一位
            priorityFolders.unshift(modelName);
        }
        // 如果已经在第一位(index === 0)，不需要操作

        console.log(`更新后的优先级列表: ${priorityFolders.join(', ')}`);

        // 保存priorityFolders到main.js文件
        try {
            const mainJsPath = path.join(app.getAppPath(), 'main.js');
            let mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

            // 构建新的priorityFolders数组字符串
            const newPriorityString = `['${priorityFolders.join("', '")}']`;

            // 替换main.js中的priorityFolders定义
            mainJsContent = mainJsContent.replace(
                /const priorityFolders = \[.*?\];/,
                `const priorityFolders = ${newPriorityString};`
            );

            // 写回文件
            fs.writeFileSync(mainJsPath, mainJsContent, 'utf8');
            console.log('已保存模型优先级到main.js');
        } catch (saveError) {
            console.error('保存优先级到main.js失败:', saveError);
            // 不影响继续执行
        }

        // 调用更新模型的函数
        const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
        modelPathUpdater.update();

        // 通知渲染进程需要重新加载以应用新模型
        const win = BrowserWindow.fromWebContents(event.sender)
        win.reload()

        return { success: true, message: `模型已切换到 ${modelName}，页面将重新加载` }
    } catch (error) {
        console.error('切换模型时出错:', error)
        return { success: false, message: `切换失败: ${error.message}` }
    }
})

// 添加保存模型位置的IPC处理器
ipcMain.on('save-model-position', (event, position) => {
    try {
        // 读取当前配置
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const win = BrowserWindow.fromWebContents(event.sender)

        // 更新位置信息
        if (!configData.ui) {
            configData.ui = {};
        }
        if (!configData.ui.model_position) {
            configData.ui.model_position = {
                x: null,
                y: null,
                remember_position: true
            };
        }

        const savedPosition = windowPlacementService.buildModelPositionPayload(win, position)

        configData.ui.model_position = {
            remember_position: true,
            display_id: savedPosition.display_id,
            display_relative: savedPosition.display_relative,
            desktop_global: savedPosition.desktop_global,
            display_snapshot: savedPosition.display_snapshot
        };
        configData.ui.model_scale = savedPosition.scale;

        // 保存到文件
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

    } catch (error) {
        console.error('保存模型位置失败:', error);
    }
})
