// ============================================================
// Cloudflare Tunnel wrapper — chạy qua PM2
// Tự parse URL từ output cloudflared → lưu vào cloudflare-url.txt
// ============================================================

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const TUNNEL_PORT = process.env.PORT || 3000;
const URL_FILE = path.join(__dirname, "cloudflare-url.txt");

// Xóa URL cũ khi khởi động
try { fs.unlinkSync(URL_FILE); } catch { /* ignore */ }

// Tìm cloudflared trong thư mục project hoặc PATH
const candidates = [
    path.join(__dirname, "cloudflared.exe"),
    path.join(__dirname, "cloudflared"),
    "cloudflared"
];
let cfCmd = "cloudflared";
for (const p of candidates) {
    try {
        if (p !== "cloudflared" && fs.existsSync(p)) { cfCmd = p; break; }
    } catch { /* ignore */ }
}

console.log("[Tunnel] Khởi động Cloudflare Tunnel...");

const proc = spawn(cfCmd, ["tunnel", "--url", `http://localhost:${TUNNEL_PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
});

function handleOutput(data) {
    const text = data.toString();
    process.stdout.write(text);

    // Parse URL từ dòng: https://xxxx.trycloudflare.com
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
        const url = match[0].trim();
        fs.writeFileSync(URL_FILE, url, "utf8");
        console.log("\n[Tunnel] ✓ URL đã lưu:", url);
        console.log("[Tunnel] Khách hàng truy cập qua URL này.\n");
    }
}

proc.stdout.on("data", handleOutput);
proc.stderr.on("data", handleOutput);

proc.on("error", (err) => {
    if (err.code === "ENOENT") {
        console.error("\n[Tunnel] LỖI: Không tìm thấy cloudflared!");
        console.error("[Tunnel] Chạy setup.bat để tải về.");
    } else {
        console.error("[Tunnel] Lỗi:", err.message);
    }
    process.exit(1);
});

proc.on("exit", (code) => {
    try { fs.unlinkSync(URL_FILE); } catch { /* ignore */ }
    console.log("[Tunnel] cloudflared thoát, code:", code);
    process.exit(code || 0);
});

process.on("SIGINT",  () => proc.kill("SIGINT"));
process.on("SIGTERM", () => proc.kill("SIGTERM"));
