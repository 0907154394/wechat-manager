const express = require("express");
const router = express.Router();
const Account = require("../models/Account");
const Message = require("../models/Message");

// ── Rate limiter: tối đa 60 req / phút / IP ──────────────────────────────
const msgHits = new Map(); // ip → { count, resetAt }

setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of msgHits.entries()) {
        if (now > e.resetAt) msgHits.delete(ip);
    }
}, 2 * 60 * 1000);

function checkMsgRate(ip) {
    const now = Date.now();
    const WINDOW = 60 * 1000; // 1 phút
    const MAX    = 60;

    let e = msgHits.get(ip);
    if (!e || now > e.resetAt) e = { count: 0, resetAt: now + WINDOW };
    e.count++;
    msgHits.set(ip, e);

    return e.count > MAX;
}

router.get("/:token", async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (checkMsgRate(ip)) {
        return res.status(429).json({ message: "Quá nhiều yêu cầu, thử lại sau." });
    }
    try {
        const account = await Account.findOne({ messageToken: req.params.token });

        if (!account) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        const messages = await Message.find({ accountId: account._id }).sort({ createdAt: -1 });

        res.json({
            account: {
                email: account.email,
                wechatId: account.wechatId,
                status: account.status,
                messageToken: account.messageToken
            },
            messages
        });
    } catch (error) {
        console.error("get messages error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.post("/add-test", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const sender = String(req.body.sender || "System").trim();
        const subject = String(req.body.subject || "").trim();
        const content = String(req.body.content || "").trim();

        if (!email || !content) {
            return res.status(400).json({ message: "Thiếu email hoặc content" });
        }

        const account = await Account.findOne({ email });

        if (!account) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        const msg = new Message({
            accountId: account._id,
            sender,
            subject,
            content
        });

        await msg.save();

        res.json({
            message: "Đã thêm tin nhắn test",
            data: msg
        });
    } catch (error) {
        console.error("add-test error:", error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;