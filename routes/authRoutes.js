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

        if (!req.session) {
            return res.status(500).json({
                message: "Session chưa được cấu hình trên server"
            });
        }

        req.session.regenerate((err) => {
            if (err) {
                console.error("session regenerate error:", err);
                return res.status(500).json({
                    message: "Lỗi đăng nhập"
                });
            }

            req.session.isAdmin = true;
            req.session.adminUsername = username;

            return res.json({
                success: true,
                message: "Đăng nhập thành công",
                username
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
    if (!req.session) {
        return res.json({
            success: true,
            message: "Đã đăng xuất"
        });
    }

    req.session.destroy((err) => {
        if (err) {
            console.error("logout error:", err);
            return res.status(500).json({
                message: "Không thể đăng xuất"
            });
        }

        res.clearCookie("wechat.sid");
        return res.json({
            success: true,
            message: "Đã đăng xuất"
        });
    });
});

router.get("/me", (req, res) => {
    return res.json({
        isAdmin: !!(req.session && req.session.isAdmin),
        username: req.session?.adminUsername || null
    });
});

module.exports = router;