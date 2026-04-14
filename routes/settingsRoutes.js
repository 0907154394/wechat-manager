const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Cập nhật 1 key trong file .env (giữ nguyên các dòng khác)
function updateEnvFile(updates) {
    const envPath = path.join(__dirname, "..", ".env");
    let lines = [];
    try { lines = fs.readFileSync(envPath, "utf8").split("\n"); } catch { /* tạo mới nếu chưa có */ }

    for (const [key, val] of Object.entries(updates)) {
        const idx = lines.findIndex(l => l.trim().startsWith(key + "="));
        if (idx >= 0) lines[idx] = `${key}=${val}`;
        else lines.push(`${key}=${val}`);
    }

    fs.writeFileSync(envPath, lines.join("\n"), "utf8");
}

// PUT /api/settings/credentials
router.put("/credentials", (req, res) => {
    const currentPassword = String(req.body.currentPassword || "").trim();
    const newUsername     = String(req.body.newUsername     || "").trim();
    const newPassword     = String(req.body.newPassword     || "").trim();

    if (!currentPassword || !newUsername || !newPassword) {
        return res.status(400).json({ message: "Thiếu thông tin" });
    }

    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
    if (currentPassword !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Mật khẩu hiện tại không đúng" });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ message: "Mật khẩu mới phải có ít nhất 6 ký tự" });
    }

    // Cập nhật process.env ngay lập tức
    process.env.ADMIN_USERNAME = newUsername;
    process.env.ADMIN_PASSWORD = newPassword;

    // Ghi vào .env để giữ sau khi restart
    try {
        updateEnvFile({ ADMIN_USERNAME: newUsername, ADMIN_PASSWORD: newPassword });
    } catch (err) {
        return res.status(500).json({ message: "Lưu file .env thất bại: " + err.message });
    }

    res.json({ message: "Đã cập nhật thành công" });
});

// GET /api/settings/info — trả về username hiện tại (không trả password)
router.get("/info", (_req, res) => {
    res.json({ username: process.env.ADMIN_USERNAME || "admin" });
});

module.exports = router;
