// ============================================================
// Chạy IMAP worker độc lập trên máy local
// Kết nối MongoDB Atlas, không cần web server
//
// Cách dùng:
//   node worker-standalone.js
// ============================================================

const fs = require("fs");
const path = require("path");

// Tự load .env (không cần cài dotenv)
function loadEnv() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (key && !process.env[key]) {
            process.env[key] = value;
        }
    }
}

loadEnv();

const mongoose = require("mongoose");
const { startWorker, getWorkerStatus } = require("./imapWorker");

const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/wechat";

console.log("=== Gmail API Worker Standalone ===");
console.log("Connecting to MongoDB...");

mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("MongoDB connected");

        // Load credentials từ MongoDB Settings
        const Settings = require("./models/Settings");
        Settings.find({ key: { $in: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"] } }).then(docs => {
            for (const d of docs) process.env[d.key] = d.value;
            if (docs.length) console.log("Gmail client credentials loaded from DB");
            
            console.log("Starting Gmail API worker...");
            startWorker();
            console.log("Worker running. Checking email every 20 seconds.");
            console.log("Press Ctrl+C to stop.\n");
        }).catch(err => {
            console.error("Lỗi load credentials từ DB:", err.message);
            console.log("Starting Gmail API worker...");
            startWorker();
            console.log("Worker running. Checking email every 20 seconds.");
            console.log("Press Ctrl+C to stop.\n");
        });

        // In status mỗi 60 giây
        setInterval(() => {
            const s = getWorkerStatus();
            const time = s.lastRunAt
                ? new Date(s.lastRunAt).toLocaleTimeString("vi-VN")
                : "-";
            console.log(
                `[${new Date().toLocaleTimeString("vi-VN")}] Active accounts: ${s.activeAccounts} | Last run: ${time} | Error: ${s.lastError || "none"}`
            );
        }, 60000);
    })
    .catch((err) => {
        console.error("MongoDB connection failed:", err.message);
        process.exit(1);
    });

process.on("SIGINT", () => {
    console.log("\nStopping worker...");
    process.exit(0);
});
