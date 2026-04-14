const { app, BrowserWindow, Tray, Menu, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs   = require("fs");
const net  = require("net");
const { autoUpdater } = require("electron-updater");

const PORT = 3000;

let mainWindow = null;
let tray = null;
let cfProcess = null;

// Bắt lỗi uncaught trong main process — tránh Electron hiện dialog lỗi
process.on("uncaughtException", err => {
    console.error("[main:uncaughtException]", err.message);
});
process.on("unhandledRejection", err => {
    console.error("[main:unhandledRejection]", err?.message);
});

// ── Icon ──────────────────────────────────────────────────────────────────
function getIconPath() {
    const candidates = [
        path.join(__dirname, "assets", "icon.ico"),
        path.join(__dirname, "assets", "icon.png")
    ];
    return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

// ── Kiểm tra port có đang bị chiếm không ─────────────────────────────────
function isPortFree(port) {
    return new Promise(resolve => {
        const srv = net.createServer();
        srv.once("listening", () => { srv.close(); resolve(true); });
        srv.once("error",     () => resolve(false));
        srv.listen(port, "0.0.0.0"); // kiểm tra trên tất cả interfaces như Express
    });
}

// ── Express server ────────────────────────────────────────────────────────
function startServer() {
    try {
        require("./server.js");
        console.log("[App] Server started on port", PORT);
    } catch (err) {
        console.error("[App] Server error:", err.message);
    }
}

// ── Cloudflare Tunnel ─────────────────────────────────────────────────────
function startTunnel() {
    const exe = [
        path.join(__dirname, "cloudflared.exe"),
        path.join(__dirname, "cloudflared")
    ].find(p => { try { return fs.existsSync(p); } catch { return false; } });

    if (!exe) {
        console.log("[Tunnel] cloudflared không tìm thấy, bỏ qua tunnel.");
        return;
    }

    const urlFile = path.join(__dirname, "cloudflare-url.txt");
    try { fs.unlinkSync(urlFile); } catch { /* ignore */ }

    cfProcess = spawn(exe, ["tunnel", "--url", `http://localhost:${PORT}`], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
    });

    [cfProcess.stdout, cfProcess.stderr].forEach(stream => {
        stream.on("data", data => {
            const m = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
            if (m) {
                fs.writeFileSync(urlFile, m[0].trim(), "utf8");
                console.log("[Tunnel] URL:", m[0].trim());
            }
        });
    });

    cfProcess.on("exit", () => {
        try { fs.unlinkSync(urlFile); } catch { /* ignore */ }
    });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────
function createWindow() {
    const icon = getIconPath();

    mainWindow = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 960,
        minHeight: 620,
        title: "WeChat Manager",
        ...(icon ? { icon } : {}),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    // Hiện splash ngay, không đợi server
    mainWindow.loadFile(path.join(__dirname, "splash.html")).catch(() => {});

    // Poll đến khi server lắng nghe, rồi navigate
    const waitForServer = (attempt = 0) => {
        isPortFree(PORT).then(free => {
            if (!free) {
                mainWindow.loadURL(`http://localhost:${PORT}`).catch(() => {});
            } else if (attempt < 80) {
                setTimeout(() => waitForServer(attempt + 1), 200);
            }
        }).catch(() => {
            if (attempt < 80) setTimeout(() => waitForServer(attempt + 1), 200);
        });
    };
    setTimeout(() => waitForServer(), 150);

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
        // Windows focus steal fix — setAlwaysOnTop trick forces the OS to grant focus
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.webContents.focus();
        setTimeout(() => {
            mainWindow.setAlwaysOnTop(false);
            mainWindow.focus();
        }, 200);
    });

    // Đóng cửa sổ → thu vào tray, không thoát
    mainWindow.on("close", e => {
        e.preventDefault();
        mainWindow.hide();
    });
}

// ── System Tray ───────────────────────────────────────────────────────────
function createTray() {
    const icon = getIconPath();
    if (!icon) return; // tray cần icon

    tray = new Tray(icon);
    tray.setToolTip("WeChat Manager");
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: "Mở WeChat Manager",
            click: () => { mainWindow.show(); mainWindow.focus(); }
        },
        { type: "separator" },
        {
            label: "Thoát",
            click: () => app.quit()
        }
    ]));

    tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
}

// ── Auto Updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on("update-available", info => {
        dialog.showMessageBox({
            type: "info",
            title: "Có bản cập nhật mới",
            message: `Phiên bản ${info.version} đang tải về nền.\nApp sẽ thông báo khi sẵn sàng cài.`,
            buttons: ["OK"]
        });
    });

    // Thanh tiến trình trên taskbar icon (Windows native)
    autoUpdater.on("download-progress", progress => {
        const pct = Math.round(progress.percent);
        if (mainWindow) {
            mainWindow.setProgressBar(progress.percent / 100);
            mainWindow.setTitle(`WeChat Manager — Đang tải cập nhật: ${pct}%`);
        }
    });

    autoUpdater.on("update-downloaded", info => {
        if (mainWindow) {
            mainWindow.setProgressBar(-1);   // xoá progress bar
            mainWindow.setTitle("WeChat Manager");
        }
        dialog.showMessageBox({
            type: "info",
            title: `Cập nhật ${info.version} sẵn sàng`,
            message: "Bản cập nhật đã tải xong.\nCần khởi động lại để cài đặt.",
            buttons: ["Khởi động lại ngay", "Để sau"]
        }).then(result => {
            if (result.response === 0) {
                // isSilent=false: hiện installer, isForceRunAfter=true: tự mở lại sau cài
                autoUpdater.quitAndInstall(false, true);
            }
        });
    });

    autoUpdater.on("error", err => {
        console.error("[AutoUpdater]", err.message);
    });

    // Kiểm tra update 10 giây sau khi khởi động
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 10000);
}

// ── Single instance lock ──────────────────────────────────────────────────
// Nếu app đã chạy rồi: instance mới tắt ngay, cửa sổ cũ lên focus
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // ── App lifecycle ─────────────────────────────────────────────────────
    app.whenReady().then(async () => {
        // 1. Kiểm tra port — chỉ trigger khi app khác (không phải instance của mình) chiếm cổng
        const free = await isPortFree(PORT);
        if (!free) {
            dialog.showErrorBox(
                "Cổng đang bận",
                `Cổng ${PORT} đang được dùng bởi ứng dụng khác.\n\nKiểm tra xem WeChat Manager có đang chạy rồi không,\nhoặc đổi PORT trong file .env.`
            );
            app.quit();
            return;
        }

        // 2. Khởi động server
        startServer();

        // 3. Sau 9 giây kiểm tra MongoDB — nếu lỗi thì hiện dialog cảnh báo
        setTimeout(() => {
            const status = global._mongoStatus || "";
            if (status.startsWith("failed")) {
                const errMsg = status.replace("failed:", "").trim();
                dialog.showMessageBox({
                    type: "error",
                    title: "Lỗi kết nối Database",
                    message: "Không kết nối được MongoDB!",
                    detail: `${errMsg}\n\nKiểm tra:\n• File .env có đúng MONGO_URI không\n• MongoDB có đang chạy không (Services → MongoDB)`
                });
            }
        }, 9000);

        // 4. Khởi động tunnel + cửa sổ + tray
        startTunnel();
        createWindow();
        createTray();

        // 5. Kiểm tra update
        setupAutoUpdater();
    });

    // Không thoát khi đóng cửa sổ (đã handle ở mainWindow close event)
    app.on("window-all-closed", () => { /* keep alive in tray */ });
}

app.on("before-quit", () => {
    if (cfProcess) cfProcess.kill();
    try { fs.unlinkSync(path.join(__dirname, "cloudflare-url.txt")); } catch { /* ignore */ }
});
