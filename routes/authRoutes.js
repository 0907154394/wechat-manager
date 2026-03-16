const express = require("express");
const bcrypt = require("bcryptjs");

const router = express.Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync("admin123", 10);

router.post("/login", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ message: "Vui lòng nhập tài khoản và mật khẩu" });
        }

        if (username !== ADMIN_USERNAME) {
            return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
        }

        const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

        if (!ok) {
            return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
        }

        req.session.isAdmin = true;
        req.session.adminUsername = username;

        return res.json({ message: "Đăng nhập thành công" });
    } catch (error) {
        console.error("login error:", error);
        return res.status(500).json({ message: "Lỗi đăng nhập" });
    }
});

router.post("/logout", (req, res) => {
    req.session.destroy(() => {
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