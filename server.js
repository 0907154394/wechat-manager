const fs = require("fs");
const path = require("path");

// Bắt lỗi không được xử lý — tránh crash Electron khi IMAP socket timeout
process.on("uncaughtException", err => {
    console.error("[uncaughtException]", err.message);
});
process.on("unhandledRejection", err => {
    console.error("[unhandledRejection]", err && err.message);
});

// Load .env thủ công (không cần dotenv package)
(function loadEnv() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.substring(0, eq).trim();
        const val = trimmed.substring(eq + 1).trim();
        if (key) process.env[key] = val;
    }
})();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const Account = require("./models/Account");
const accountRoutes = require("./routes/accountRoutes");
const messageRoutes = require("./routes/messageRoutes");
const workerRoutes = require("./routes/workerRoutes");
const authRoutes = require("./routes/authRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const { authMiddleware } = require("./middleware/auth");
const { startWorker } = require("./imapWorker");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wechat";

const PORT = process.env.PORT || 3000;

// MongoDB connect → tự động start IMAP worker sau khi kết nối
global._mongoStatus = "connecting";
mongoose
    .connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => {
        global._mongoStatus = "connected";
        console.log("MongoDB connected");
        startWorker();
        console.log("IMAP worker started");
    })
    .catch((err) => {
        global._mongoStatus = "failed:" + err.message;
        console.error("MongoDB error:", err.message);
    });

// Public auth route (no auth required)
app.use("/api/auth", authRoutes);

// Protected admin API routes
app.use("/api/accounts", authMiddleware, accountRoutes);
app.use("/api/worker", authMiddleware, workerRoutes);
app.use("/api/settings", authMiddleware, settingsRoutes);

// Public message route (customer access via token)
app.use("/api/messages", messageRoutes);

// Health checks (public)
app.get("/ping", (_req, res) => res.send("pong"));
app.get("/health", (_req, res) => res.json({
    ok: global._mongoStatus === "connected",
    db: global._mongoStatus || "unknown"
}));

// Public URL config — đọc từ file do cloudflare-worker.js ghi
app.get("/api/config", (_req, res) => {
    const urlFile = path.join(__dirname, "cloudflare-url.txt");
    let publicUrl = "";
    try { publicUrl = fs.readFileSync(urlFile, "utf8").trim(); } catch { /* tunnel chưa chạy */ }
    res.json({ publicUrl });
});

// Public customer link route (link hết hạn sau 20 phút)
app.get("/m/:token", async (req, res) => {
    try {
        const fullLinkToken = "/m/" + String(req.params.token).trim();
        const account = await Account.findOne({ linkToken: fullLinkToken });

        if (!account) {
            return res.status(404).send(`
                <html><head><meta charset="UTF-8"><style>
                body{font-family:sans-serif;background:#060c18;color:#dde6f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}
                .box{padding:32px;background:#0f1e35;border-radius:16px;border:1px solid rgba(239,68,68,.3)}
                h2{color:#ef4444;margin:0 0 10px}p{color:#7e96b8;margin:0}
                </style></head><body>
                <div class="box"><h2>Link không hợp lệ hoặc đã hết hạn</h2>
                <p>Liên hệ người bán để nhận link mới.</p></div>
                </body></html>`);
        }

        // Kiểm tra hết hạn 20 phút
        if (account.linkTokenExpiresAt && account.linkTokenExpiresAt.getTime() < Date.now()) {
            return res.status(410).send(`
                <html><head><meta charset="UTF-8"><style>
                body{font-family:sans-serif;background:#060c18;color:#dde6f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}
                .box{padding:32px;background:#0f1e35;border-radius:16px;border:1px solid rgba(251,146,60,.3)}
                h2{color:#fb923c;margin:0 0 10px}p{color:#7e96b8;margin:0}
                </style></head><body>
                <div class="box"><h2>Link đã hết hạn (20 phút)</h2>
                <p>Liên hệ người bán để nhận link mới.</p></div>
                </body></html>`);
        }

        if (!account.messageToken) {
            return res.status(400).send("Account chưa có message token");
        }

        return res.redirect(
            "/messages.html?token=" + encodeURIComponent(account.messageToken)
        );
    } catch (error) {
        console.error("route /m/:token error:", error);
        return res.status(500).send("Lỗi hệ thống");
    }
});

// Serve static files (login.html, messages.html, CSS, JS)
// index.html is NOT served by static - handled below with auth guard
app.use(
    express.static(path.join(__dirname, "public"), {
        index: false // prevent auto-serving index.html
    })
);

// Admin dashboard - served only to authenticated users
// (JS-level auth: the page itself checks localStorage token)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Fallback
app.use((req, res) => {
    res.status(404).send("Not Found");
});

// Start server
const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
httpServer.on("error", err => {
    console.error("[Server] Listen error:", err.message);
});
