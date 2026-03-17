const express = require("express");
const router = express.Router();
const Message = require("../models/Message");

// GET /api/messages
router.get("/", async (req, res) => {
    try {
        const messages = await Message.find({})
            .sort({ createdAt: -1 })
            .limit(100);

        return res.json(messages);
    } catch (error) {
        console.error("get messages error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Get messages failed"
        });
    }
});

module.exports = router;