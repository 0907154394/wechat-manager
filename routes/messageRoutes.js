const express = require("express");
const router = express.Router();
const Message = require("../models/Message");

router.get("/", async (req, res) => {
    try {
        const accountId = String(req.query.accountId || "").trim();

        const query = accountId ? { accountId } : {};

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(100);

        res.json(messages);
    } catch (error) {
        console.error("get messages error:", error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;