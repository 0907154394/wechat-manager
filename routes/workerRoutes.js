const express = require("express");
const router = express.Router();

router.get("/status", (req, res) => {
    return res.json({
        success: true,
        message: "Local worker is running on your PC, not on Render"
    });
});

router.post("/start", (req, res) => {
    return res.json({
        success: true,
        message: "Local worker must be started from your PC terminal"
    });
});

router.post("/stop", (req, res) => {
    return res.json({
        success: true,
        message: "Stop local worker from your PC terminal"
    });
});

router.post("/reload", (req, res) => {
    return res.json({
        success: true,
        message: "Reload local worker accounts from MongoDB"
    });
});

module.exports = router;