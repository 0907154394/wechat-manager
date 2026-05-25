const { app, BrowserWindow, Tray, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs   = require("fs");
const net  = require("net");


const PORT = 3000;

let mainWindow = null;
let tray = null;
let cfProcess = null;
let setupWindow = null;
let userDataPath = null;
let configFile = null;
let autoUpdaterRef = null;

function initPaths() {
    userDataPath = app.getPath("userData");
    configFile = path.join(userDataPath, "config.json");
}

function loadConfig() {
    // 1. Try %APPDATA%/config.json
    try {
        const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
        for (const [k, v] of Object.entries(cfg)) process.env[k] = String(v);
        process.env.CONFIG_LOADED = "1";
        return true;
    } catch {}

    // 2. Fall back to bundled app-config.json (config baked into installer)
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "app-config.json"), "utf8"));
        if (cfg.MONGODB_URI) {
            for (const [k, v] of Object.entries(cfg)) process.env[k] = String(v);
            saveConfig(cfg);
            process.env.CONFIG_LOADED = "1";
            console.log("[Config] Loaded app-config.json → migrated to config.json");
            return true;
        }
    } catch {}

    // 3. Fall back to bundled .env (legacy dev fallback)
    try {
        const content = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
        const cfg = {};
        for (const line of content.split(/\r?\n/)) {
            const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (m) { cfg[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); process.env[m[1]] = cfg[m[1]]; }
        }
        if (cfg.MONGODB_URI) {
            saveConfig(cfg);
            process.env.CONFIG_LOADED = "1";
            console.log("[Config] Migrated .env → config.json");
            return true;
        }
    } catch {}

    return false;
}

function saveConfig(cfg) {
    try {
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf8");
        return true;
    } catch (err) {
        console.error("[Config] Save error:", err.message);
        return false;
    }
}


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
        backgroundColor: "#060c18",
        ...(icon ? { icon } : {}),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    // Hiện splash ngay, không đợi server
    mainWindow.loadFile(path.join(__dirname, "splash.html")).catch(() => {});

    // Poll đến khi server sẵn sàng, rồi navigate
    const waitForServer = (attempt = 0) => {
        const socket = net.createConnection(PORT, "127.0.0.1");
        socket.once("connect", () => {
            socket.destroy();
            // Luôn mở thẳng login — không qua index
            mainWindow.loadURL(`http://localhost:${PORT}/login.html`).catch(() => {});
        });
        socket.once("error", () => {
            socket.destroy();
            if (attempt < 80) setTimeout(() => waitForServer(attempt + 1), 200);
        });
    };
    setTimeout(() => waitForServer(), 150);

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Đóng cửa sổ → thu vào tray, không thoát
    mainWindow.on("close", e => {
        e.preventDefault();
        mainWindow.hide();
    });
}

// ── Setup Window ──────────────────────────────────────────────────────────
function createSetupWindow() {
    const icon = getIconPath();
    setupWindow = new BrowserWindow({
        width: 520,
        height: 660,
        resizable: false,
        title: "WeChat Manager — Thiết lập",
        backgroundColor: "#060c18",
        ...(icon ? { icon } : {}),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    setupWindow.setMenu(null);
    setupWindow.loadFile(path.join(__dirname, "public", "setup.html"));
    setupWindow.once("closed", () => { setupWindow = null; });
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
            label: "Kiểm tra cập nhật",
            click: () => checkForUpdates()
        },
        {
            label: "Cài đặt kết nối...",
            click: () => {
                if (setupWindow) { setupWindow.focus(); return; }
                createSetupWindow();
            }
        },
        {
            label: "Thoát",
            click: () => app.quit()
        },
        { type: "separator" },
        {
            label: "Gỡ cài đặt...",
            click: () => {
                const uninstaller = path.join(path.dirname(app.getPath("exe")), "Uninstall WeChat Manager.exe");
                dialog.showMessageBox({
                    type: "warning",
                    title: "Gỡ cài đặt",
                    message: "Bạn có chắc muốn gỡ cài đặt WeChat Manager?",
                    buttons: ["Gỡ cài đặt", "Huỷ"],
                    defaultId: 1
                }).then(result => {
                    if (result.response === 0) {
                        app.quit();
                        setTimeout(() => { spawn(uninstaller, [], { detached: true, stdio: "ignore" }).unref(); }, 500);
                    }
                });
            }
        }
    ]));

    tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
}

// ── Auto Updater ──────────────────────────────────────────────────────────────
function showUpdateError(err) {
    const msg = err?.message || String(err);
    console.error("[AutoUpdater]", msg);
    if (tray) tray.setToolTip("WeChat Manager");
    dialog.showMessageBox({
        type: "error",
        title: "Lỗi cập nhật",
        message: "Không thể kiểm tra/tải cập nhật.",
        detail: msg
    }).catch(() => {});
}

function checkForUpdates() {
    if (!autoUpdaterRef) return;
    if (tray) tray.setToolTip("WeChat Manager — Đang kiểm tra cập nhật...");
    autoUpdaterRef.checkForUpdates().catch(showUpdateError);
}

function setupAutoUpdater() {
    const { autoUpdater } = require("electron-updater");
    autoUpdaterRef = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null; // tắt log spam của electron-updater

    // Xác thực với GitHub private repo — set cả env lẫn header
    const ghToken = process.env.GH_PAT || process.env.GH_TOKEN;
    if (ghToken) {
        process.env.GH_TOKEN = ghToken;
        autoUpdater.requestHeaders = { Authorization: `token ${ghToken}` };
    } else {
        console.warn("[AutoUpdater] Không có GH_TOKEN — private repo sẽ thất bại");
    }

    autoUpdater.on("update-available", info => {
        console.log(`[AutoUpdater] Tìm thấy v${info.version}, đang tải...`);
        if (tray) tray.setToolTip(`WeChat Manager — Đang tải v${info.version}...`);
    });

    autoUpdater.on("update-not-available", () => {
        if (tray) tray.setToolTip("WeChat Manager");
    });

    autoUpdater.on("download-progress", progress => {
        const pct = Math.round(progress.percent);
        if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
        if (tray) tray.setToolTip(`WeChat Manager — Đang tải cập nhật: ${pct}%`);
    });

    // Tải xong → tự cài sau 3 giây (silent)
    autoUpdater.on("update-downloaded", info => {
        if (mainWindow) mainWindow.setProgressBar(-1);
        if (tray) tray.setToolTip(`WeChat Manager — Cập nhật v${info.version} sẵn sàng`);
        console.log(`[AutoUpdater] v${info.version} tải xong, cài sau 3 giây...`);
        setTimeout(() => {
            autoUpdater.quitAndInstall(true, true);
        }, 3000);
    });

    autoUpdater.on("error", showUpdateError);

    // Kiểm tra update 10 giây sau khi khởi động
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(showUpdateError);
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
        // IPC: phải đăng ký sau khi app ready
        ipcMain.handle("save-config", async (_, cfg) => {
            if (!cfg.MONGODB_URI) return { ok: false, error: "Thiếu MongoDB URI" };
            for (const [k, v] of Object.entries(cfg)) if (v) process.env[k] = v;
            if (!saveConfig(cfg)) return { ok: false, error: "Không thể lưu file config" };
            setTimeout(() => { app.relaunch(); app.quit(); }, 400);
            return { ok: true };
        });

        initPaths();
        const hasConfig = loadConfig();

        if (!hasConfig) {
            createSetupWindow();
            return;
        }

        // 1. Khởi động server
        startServer();

        // 2. Sau 9 giây kiểm tra MongoDB — nếu lỗi thì hiện dialog cảnh báo
        setTimeout(() => {
            const status = global._mongoStatus || "";
            if (status.startsWith("failed")) {
                const errMsg = status.replace("failed:", "").trim();
                dialog.showMessageBox({
                    type: "error",
                    title: "Lỗi kết nối Database",
                    message: "Không kết nối được MongoDB!",
                    detail: `${errMsg}\n\nKiểm tra MongoDB URI trong Cài đặt kết nối (chuột phải tray icon).`
                });
            }
        }, 9000);

        // 3. Khởi động tunnel + cửa sổ + tray
        startTunnel();
        createWindow();
        createTray();

        // 4. Kiểm tra update
        setupAutoUpdater();
    });

    // Không thoát khi đóng cửa sổ (đã handle ở mainWindow close event)
    app.on("window-all-closed", () => { /* keep alive in tray */ });
}

app.on("before-quit", () => {
    if (cfProcess) cfProcess.kill();
    try { fs.unlinkSync(path.join(__dirname, "cloudflare-url.txt")); } catch { /* ignore */ }
});
