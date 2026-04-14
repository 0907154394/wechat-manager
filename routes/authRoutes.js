const express = require("express");
const router = express.Router();
const { createToken } = require("../middleware/auth");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// ── Rate limiter: tối đa 5 lần thử / 15 phút / IP ───────────────────────
const loginAttempts = new Map(); // ip → { count, resetAt }

// Dọn các entry hết hạn mỗi 5 phút để tránh memory leak
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttempts.entries()) {
        if (now > entry.resetAt) loginAttempts.delete(ip);
    }
}, 5 * 60 * 1000);

function checkLoginRate(ip) {
    const now = Date.now();
    const WINDOW = 15 * 60 * 1000; // 15 phút
    const MAX    = 5;

    let entry = loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + WINDOW };
    }
    entry.count++;
    loginAttempts.set(ip, entry);

    if (entry.count > MAX) {
        const waitSec = Math.ceil((entry.resetAt - now) / 1000);
        return { blocked: true, waitSec };
    }
    return { blocked: false };
}

router.post("/login", (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const rate = checkLoginRate(ip);
    if (rate.blocked) {
        return res.status(429).json({
            message: `Quá nhiều lần thử. Vui lòng đợi ${rate.waitSec} giây.`
        });
    }

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "").trim();

    if (!username || !password) {
        return res.status(400).json({ message: "Thiếu tài khoản hoặc mật khẩu" });
    }

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
    }

    // Đăng nhập thành công → reset đếm cho IP này
    loginAttempts.delete(ip);

    const token = createToken();
    res.json({ token });
});

module.exports = router;
