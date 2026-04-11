const crypto = require("crypto");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "wechat-session-secret-change-me";

// Token lifetime: 30 days
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createToken() {
    const expires = Date.now() + TOKEN_TTL_MS;
    const payload = `${expires}|${ADMIN_PASSWORD}`;
    const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    return Buffer.from(`${expires}|${hmac}`).toString("base64url");
}

function verifyToken(token) {
    if (!token || typeof token !== "string") return false;

    try {
        const decoded = Buffer.from(token, "base64url").toString("utf8");
        const pipeIdx = decoded.indexOf("|");
        if (pipeIdx < 0) return false;

        const expires = decoded.substring(0, pipeIdx);
        const hmac = decoded.substring(pipeIdx + 1);

        if (Date.now() > parseInt(expires, 10)) return false;

        const payload = `${expires}|${ADMIN_PASSWORD}`;
        const expected = crypto
            .createHmac("sha256", SESSION_SECRET)
            .update(payload)
            .digest("hex");

        if (hmac.length !== expected.length) return false;

        return crypto.timingSafeEqual(
            Buffer.from(hmac, "hex"),
            Buffer.from(expected, "hex")
        );
    } catch {
        return false;
    }
}

function authMiddleware(req, res, next) {
    const header = req.headers["x-admin-token"] || "";
    const bearer = req.headers["authorization"] || "";
    const token = header || bearer.replace(/^Bearer\s+/i, "").trim();

    if (verifyToken(token)) {
        return next();
    }

    return res.status(401).json({ message: "Chưa đăng nhập hoặc phiên hết hạn" });
}

module.exports = { createToken, verifyToken, authMiddleware };
