const express = require("express");
const router = express.Router();

const {
    startWorker,
    stopWorker,
    reloadAccounts,
    getStatus
} = require("../imapWorker");

router.get("/status", async (req, res) => {
    try {
        res.json(getStatus());
    } catch (error) {
        console.error("worker status error:", error);
        res.status(500).json({ message: error.message || "Worker status error" });
    }
});

router.post("/start", async (req, res) => {
    try {
        const data = startWorker();
        res.json({ message: "Worker started", ...data });
    } catch (error) {
        console.error("worker start error:", error);
        res.status(500).json({ message: error.message || "Worker start error" });
    }
});

router.post("/stop", async (req, res) => {
    try {
        const data = stopWorker();
        res.json({ message: "Worker stopped", ...data });
    } catch (error) {
        console.error("worker stop error:", error);
        res.status(500).json({ message: error.message || "Worker stop error" });
    }
});

router.post("/reload", async (req, res) => {
    try {
        const data = await reloadAccounts();
        res.json({ message: "Reloaded", ...data });
    } catch (error) {
        console.error("worker reload error:", error);
        res.status(500).json({ message: error.message || "Worker reload error" });
    }
});

module.exports = router;