const express = require("express");
const router = express.Router();

const {
    startWorker,
    stopWorker,
    reloadAccounts,
    getWorkerStatus
} = require("../imapWorker");

router.get("/status", (req, res) => {
    res.json(getWorkerStatus());
});

router.post("/start", (req, res) => {
    const state = startWorker();
    res.json({
        message: "Worker started",
        state
    });
});

router.post("/stop", (req, res) => {
    const state = stopWorker();
    res.json({
        message: "Worker stopped",
        state
    });
});

router.post("/reload", async (req, res) => {
    try {
        const state = await reloadAccounts();
        res.json({
            message: "Reload accounts success",
            state
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;