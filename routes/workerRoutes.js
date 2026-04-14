const express = require("express");
const router = express.Router();

const {
    startWorker,
    stopWorker,
    reloadAccounts,
    getWorkerStatus
} = require("../imapWorker");

function safeStatus() {
    const s = getWorkerStatus();
    return {
        running:        s.running        || false,
        activeAccounts: s.activeAccounts || 0,
        lastRunAt:      s.lastRunAt      || null,
        lastError:      s.lastError      || null,
        accountErrors:  s.accountErrors  || {}
    };
}

router.get("/status", (_req, res) => {
    res.json(safeStatus());
});

router.post("/start", (_req, res) => {
    startWorker();
    res.json({ message: "Worker started", ...safeStatus() });
});

router.post("/stop", (_req, res) => {
    stopWorker();
    res.json({ message: "Worker stopped", ...safeStatus() });
});

router.post("/reload", async (_req, res) => {
    try {
        await reloadAccounts();
        res.json({ message: "Reload success", ...safeStatus() });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
