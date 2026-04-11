const express = require("express");
const router = express.Router();
const { createToken } = require("../middleware/auth");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

router.post("/login", (req, res) => {
    const password = String(req.body.password || "").trim();

    if (!password) {
        return res.status(400).json({ message: "Thiếu mật khẩu" });
    }

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Sai mật khẩu" });
    }

    const token = createToken();
    res.json({ token });
});

module.exports = router;
