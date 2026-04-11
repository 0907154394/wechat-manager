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

console.log("=== IMAP Worker Standalone ===");
console.log("Connecting to MongoDB...");

mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log("MongoDB connected");
        console.log("Starting IMAP worker...");
        startWorker();
        console.log("Worker running. Checking email every 30 seconds.");
        console.log("Press Ctrl+C to stop.\n");

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
