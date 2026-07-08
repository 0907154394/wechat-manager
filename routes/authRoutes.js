const express = require("express");
const router = express.Router();
const { createToken } = require("../middleware/auth");


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

    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
    if (username.toLowerCase() !== ADMIN_USERNAME.toLowerCase() || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
    }

    // Đăng nhập thành công → reset đếm cho IP này
    loginAttempts.delete(ip);

    const token = createToken();
    res.json({ token });
});

// Google OAuth callback
const https = require("https");
const querystring = require("querystring");
const Account = require("../models/Account");

// Normalize Gmail local part (xóa dấu chấm)
function normalizeGmailLocal(email) {
    const [local, domain] = email.toLowerCase().split("@");
    if (!domain) return email.toLowerCase();
    if (domain === "gmail.com" || domain === "googlemail.com")
        return local.replace(/\./g, "") + "@" + domain;
    return email.toLowerCase();
}

router.get("/google/callback", async (req, res) => {
    const { code, state } = req.query; // state is the base email address (e.g. abc@gmail.com)

    if (!code || !state) {
        return res.status(400).send("Lỗi: Thiếu code hoặc state");
    }

    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const port = process.env.PORT || 3000;
    const redirectUri = `http://localhost:${port}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
        return res.status(500).send("Lỗi: Google Client Credentials chưa được cấu hình trên server");
    }

    try {
        // Exchange code for tokens
        const tokenData = await new Promise((resolve, reject) => {
            const payload = querystring.stringify({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code"
            });

            const request = https.request({
                hostname: "oauth2.googleapis.com",
                path: "/token",
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(payload)
                }
            }, (response) => {
                let data = "";
                response.on("data", chunk => data += chunk);
                response.on("end", () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            reject(new Error(parsed.error_description || parsed.error || data));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            request.on("error", reject);
            request.write(payload);
            request.end();
        });

        const refreshToken = tokenData.refresh_token;
        const accessToken = tokenData.access_token;
        const expiresIn = tokenData.expires_in || 3600;

        const normalizedUser = normalizeGmailLocal(state);

        if (!refreshToken) {
            // Google only returns refresh_token on first authorization.
            // If the user already authorized, they need to select "prompt=consent" which we set,
            // but just in case, we inform them or we try to retrieve without overwriting if already stored.
            const allWithToken = await Account.find({ gmailRefreshToken: { $ne: "" } });
            const existingAcc = allWithToken.find(a => normalizeGmailLocal(a.email) === normalizedUser);

            if (!existingAcc) {
                return res.status(400).send(`
                    <html><head><meta charset="utf-8"><style>body{font-family:sans-serif;background:#060c18;color:#dde6f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}.box{padding:32px;background:#0f1e35;border-radius:16px;border:1px solid #ef4444}h2{color:#ef4444;margin:0 0 10px}p{color:#7e96b8;margin:0;line-height:1.6}a{color:#60a5fa}</style></head>
                    <body><div class="box"><h2>Thiếu Refresh Token</h2><p>Không nhận được Refresh Token từ Google.<br>Vui lòng truy cập trang quản lý Google của bạn, xoá quyền ứng dụng này và thử kết nối lại để Google cấp lại Refresh Token mới.</p></div></body>
                    </html>
                `);
            }
        }

        // Lấy tất cả accounts, lọc các cái có email là variant của imapUser
        const allAccounts = await Account.find({});
        const matchIds = allAccounts
            .filter(a => normalizeGmailLocal(a.email) === normalizedUser)
            .map(a => a._id);

        if (!matchIds.length) {
            return res.status(404).send("Lỗi: Không tìm thấy tài khoản phù hợp trong hệ thống");
        }

        const updates = {
            gmailAccessToken: accessToken,
            gmailTokenExpiry: new Date(Date.now() + expiresIn * 1000),
            gmailApiEnabled: true,
            gmailError: ""
        };

        if (refreshToken) {
            updates.gmailRefreshToken = refreshToken;
        }

        await Account.updateMany(
            { _id: { $in: matchIds } },
            { $set: updates }
        );

        // Thành công! Hiển thị trang kết quả
        res.send(`
            <html>
            <head>
                <meta charset="utf-8">
                <title>Kết nối Gmail API thành công</title>
                <style>
                    body { font-family: sans-serif; background: #060c18; color: #dde6f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; }
                    .box { padding: 32px; background: #0f1e35; border-radius: 16px; border: 1px solid #10b981; max-width: 450px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); }
                    h2 { color: #10b981; margin: 0 0 12px; font-size: 22px; }
                    p { color: #94a3b8; margin: 0 0 16px; line-height: 1.5; font-size: 14.5px; }
                    .email { display: inline-block; font-weight: bold; background: rgba(16, 185, 129, 0.1); color: #34d399; padding: 4px 12px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2); margin-top: 6px; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h2>Kết nối Gmail API thành công!</h2>
                    <p>Hệ thống đã nhận được quyền truy cập hộp thư Gmail API cho tài khoản:<br><span class="email">${state}</span></p>
                    <p style="font-size:13px;color:#64748b;margin-bottom:0">Bạn có thể đóng cửa sổ trình duyệt này và tiếp tục trên ứng dụng WeChat Manager.</p>
                </div>
            </body>
            </html>
        `);

    } catch (err) {
        console.error("Lỗi Google Callback:", err);
        res.status(500).send("Lỗi xác thực Google: " + err.message);
    }
});

module.exports = router;
