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
        res.status(500).json({ message: error.message });
    }
});

router.post("/start", async (req, res) => {
    try {
        const data = startWorker();
        res.json({ message: "Worker started", ...data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post("/stop", async (req, res) => {
    try {
        const data = stopWorker();
        res.json({ message: "Worker stopped", ...data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post("/reload", async (req, res) => {
    try {
        const data = await reloadAccounts();
        res.json({ message: "Reloaded", ...data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;