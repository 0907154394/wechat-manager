const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Bạn thử sai quá nhiều lần. Vui lòng đợi rồi thử lại."
    }
});

router.post("/login", loginLimiter, async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        const envUsername = String(process.env.ADMIN_USERNAME || "").trim();
        const envHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

        if (!envUsername || !envHash) {
            return res.status(500).json({
                message: "Thiếu cấu hình admin trên server"
            });
        }

        if (!username || !password) {
            return res.status(400).json({
                message: "Vui lòng nhập tài khoản và mật khẩu"
            });
        }

        if (username !== envUsername) {
            return res.status(401).json({
                message: "Sai tài khoản hoặc mật khẩu"
            });
        }

        const ok = await bcrypt.compare(password, envHash);

        if (!ok) {
            return res.status(401).json({
                message: "Sai tài khoản hoặc mật khẩu"
            });
        }

        req.session.regenerate((err) => {
            if (err) {
                console.error("session regenerate error:", err);
                return res.status(500).json({ message: "Lỗi đăng nhập" });
            }

            req.session.isAdmin = true;
            req.session.adminUsername = username;

            return res.json({
                message: "Đăng nhập thành công"
            });
        });
    } catch (error) {
        console.error("login error:", error);
        return res.status(500).json({
            message: "Lỗi đăng nhập"
        });
    }
});

router.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("wechat.sid");
        res.json({ message: "Đã đăng xuất" });
    });
});

router.get("/me", (req, res) => {
    res.json({
        isAdmin: !!(req.session && req.session.isAdmin),
        username: req.session?.adminUsername || null
    });
});

module.exports = router;