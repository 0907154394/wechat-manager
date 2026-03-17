const express = require("express");
const router = express.Router();

const worker = require("../imapWorker");

// GET /api/worker/status
router.get("/status", (req, res) => {
    try {
        const status = worker.getStatus();

        return res.json({
            running: Boolean(status.running),
            intervalMs: Number(status.intervalMs || 0),
            activeAccounts: Number(status.activeAccounts || 0),
            lastRunAt: status.lastRunAt || null,
            lastError: status.lastError || ""
        });
    } catch (err) {
        console.error("worker status error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Worker status error"
        });
    }
});

// POST /api/worker/start
router.post("/start", (req, res) => {
    try {
        worker.startWorker();

        return res.json({
            success: true,
            message: "Worker started"
        });
    } catch (err) {
        console.error("worker start error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Worker start error"
        });
    }
});

// POST /api/worker/stop
router.post("/stop", (req, res) => {
    try {
        worker.stopWorker();

        return res.json({
            success: true,
            message: "Worker stopped"
        });
    } catch (err) {
        console.error("worker stop error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Worker stop error"
        });
    }
});

// POST /api/worker/reload
router.post("/reload", async (req, res) => {
    try {
        const data = await worker.reloadAccounts();

        return res.json({
            success: true,
            message: "Reloaded accounts",
            activeAccounts: Number(data.activeAccounts || 0)
        });
    } catch (err) {
        console.error("worker reload error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Worker reload error"
        });
    }
});

module.exports = router;