const express = require("express");
const router = express.Router();
const Account = require("../models/Account");
const Message = require("../models/Message");

router.get("/by-token/:token", async (req, res) => {
    try {
        const token = String(req.params.token || "").trim();

        if (!token) {
            return res.status(400).json({ message: "Thiếu token" });
        }

        const account = await Account.findOne({ messageToken: token });

        if (!account) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        const messages = await Message.find({
            accountId: account._id
        })
            .sort({ createdAt: -1 })
            .limit(50);

        res.json({
            account: {
                email: account.email,
                messageToken: account.messageToken
            },
            messages
        });
    } catch (error) {
        console.error("message by token error:", error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;