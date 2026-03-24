const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const Account = require("../models/Account");
const { requireAdmin } = require("../middleware/auth");

// admin xem inbox theo message token
router.get("/admin/:messageToken", requireAdmin, async (req, res) => {
    try {
        const messageToken = String(req.params.messageToken || "").trim();

        if (!messageToken) {
            return res.status(400).json({
                success: false,
                message: "Thiếu message token"
            });
        }

        const account = await Account.findOne({ messageToken }).lean();

        if (!account) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy account theo message token"
            });
        }

        const messages = await Message.find({ accountId: account._id })
            .sort({ createdAt: -1 })
            .limit(100);

        return res.json(messages);
    } catch (error) {
        console.error("admin get messages error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Get messages failed"
        });
    }
});

// public: khách vào bằng /m/:linkToken
router.get("/public/:linkToken", async (req, res) => {
    try {
        const linkToken = String(req.params.linkToken || "").trim();

        if (!linkToken) {
            return res.status(400).json({
                success: false,
                message: "Thiếu link token"
            });
        }

        const account = await Account.findOne({ linkToken }).lean();

        if (!account) {
            return res.status(404).json({
                success: false,
                message: "Link không tồn tại hoặc đã hết hạn"
            });
        }

        const messages = await Message.find({ accountId: account._id })
            .sort({ createdAt: -1 })
            .limit(100);

        return res.json(messages);
    } catch (error) {
        console.error("public get messages error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Get messages failed"
        });
    }
});

module.exports = router;