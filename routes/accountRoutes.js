const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const https   = require("https");
const http    = require("http");
const { v4: uuidv4 } = require("uuid");

const Account = require("../models/Account");
const Message = require("../models/Message");

const upload = multer({ storage: multer.memoryStorage() });

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

const LINK_TTL_MS = 60 * 60 * 1000; // 1 giờ

function buildTokens() {
    return {
        linkToken:          "/m/" + uuidv4().replace(/-/g, "").substring(0, 16),
        linkTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS),
        messageToken:       uuidv4().replace(/-/g, "").substring(0, 20)
    };
}

// Đăng ký linkToken lên Cloudflare Worker (fire and forget)
function pushLinkToWorker(linkToken, messageToken, expiresAt) {
    const workerUrl = process.env.WORKER_URL;
    const secret    = process.env.WORKER_SECRET;
    if (!workerUrl || !secret) return;

    try {
        const parsed  = new URL(workerUrl + "/api/link");
        const payload = Buffer.from(JSON.stringify({
            linkToken:    linkToken.replace("/m/", ""),
            messageToken,
            expiresAt:    new Date(expiresAt).getTime()
        }));
        const lib = parsed.protocol === "https:" ? https : http;

        const req = lib.request({
            hostname: parsed.hostname,
            port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path:     parsed.pathname,
            method:   "POST",
            headers: {
                "Content-Type":   "application/json",
                "Content-Length": payload.length,
                "Authorization":  `Bearer ${secret}`
            }
        });
        req.on("error", () => {});
        req.write(payload);
        req.end();
    } catch { /* ignore */ }
}

function generateDotVariants(localPart) {
    const clean = String(localPart || "").trim();

    if (clean.length < 2) return [];

    const results = new Set();
    const gaps = clean.length - 1;
    const totalMasks = 1 << gaps;

    for (let mask = 1; mask < totalMasks; mask++) {
        let temp = clean[0];

        for (let i = 1; i < clean.length; i++) {
            if (mask & (1 << (i - 1))) {
                temp += ".";
            }
            temp += clean[i];
        }

        results.add(temp);
    }

    return Array.from(results);
}

// POST /api/accounts/create-bulk
// Tạo biến thể Gmail hàng loạt bằng cách tự sinh ra các biến thể dấu chấm (dot variants).
// Tất cả biến thể sẽ sử dụng chung Gmail gốc khi cấu hình Google API qua OAuth2.
router.post("/create-bulk", async (req, res) => {
    try {
        const baseEmail = normalizeEmail(req.body.baseEmail);
        const password = String(req.body.password || "").trim();
        const quantity = Number.parseInt(req.body.quantity, 10);

        if (!baseEmail || !baseEmail.includes("@")) {
            return res.status(400).json({ message: "Email gốc không hợp lệ" });
        }

        if (Number.isNaN(quantity) || quantity < 1) {
            return res.status(400).json({ message: "Số lượng không hợp lệ" });
        }
        if (quantity > 500) {
            return res.status(400).json({ message: "Tối đa 500 biến thể mỗi lần" });
        }

        const [localPart, domain] = baseEmail.split("@");

        if (!localPart || !domain) {
            return res.status(400).json({ message: "Email gốc không hợp lệ" });
        }

        const isGmail =
            domain === "gmail.com" || domain === "googlemail.com";

        const variants = generateDotVariants(localPart);

        if (!variants.length) {
            return res.status(400).json({
                message:
                    "Phần trước @ quá ngắn, không có biến thể dấu chấm để tạo"
            });
        }

        const allEmails = variants.map(v => `${v}@${domain}`);

        const existing = await Account.find({
            email: { $in: allEmails }
        }).select("email");

        const existingSet = new Set(existing.map(x => x.email));

        const docsToInsert = [];

        for (const local of variants) {
            if (docsToInsert.length >= quantity) break;

            const email = `${local}@${domain}`;

            if (existingSet.has(email)) continue;

            const tokens = buildTokens();

            const doc = {
                email,
                password,
                status: "CHUA BAN",
                wechatId: "",
                linkToken: tokens.linkToken,
                messageToken: tokens.messageToken
            };

            docsToInsert.push(doc);
        }

        if (!docsToInsert.length) {
            return res.status(400).json({
                message:
                    "Không còn biến thể mới để tạo hoặc tất cả đã tồn tại"
            });
        }

        const inserted = await Account.insertMany(docsToInsert);

        res.json(inserted);
    } catch (error) {
        console.error("create-bulk error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.get("/", async (req, res) => {
    try {
        const showArchived = req.query.archived === "true";
        const query = showArchived ? { archived: true } : { archived: { $ne: true } };
        const accounts = await Account.find(query).sort({ createdAt: -1 });
        const now = Date.now();

        // Xoá link đã hết hạn — không tự renew nữa, chờ user bấm "Tạo link"
        const expiredIds = accounts
            .filter(a => a.linkToken && a.linkTokenExpiresAt && a.linkTokenExpiresAt.getTime() < now)
            .map(a => a._id);

        if (expiredIds.length) {
            await Account.updateMany(
                { _id: { $in: expiredIds } },
                { $set: { linkToken: "", linkTokenExpiresAt: null } }
            );
            accounts.forEach(a => {
                if (expiredIds.some(id => id.equals(a._id))) {
                    a.linkToken = "";
                    a.linkTokenExpiresAt = null;
                }
            });
        }

        res.json(accounts);
    } catch (error) {
        console.error("get accounts error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.put("/sell/:id", async (req, res) => {
    try {
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { status: "DA BAN" },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        res.json({ message: "updated", data: updated });
    } catch (error) {
        console.error("sell error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.put("/unsell/:id", async (req, res) => {
    try {
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { status: "CHUA BAN" },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        res.json({ message: "updated", data: updated });
    } catch (error) {
        console.error("unsell error:", error);
        res.status(500).json({ message: error.message });
    }
});



router.put("/wechat-id/:id", async (req, res) => {
    try {
        const wechatId = String(req.body.wechatId || "").trim();

        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { wechatId },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        res.json({ message: "updated", data: updated });
    } catch (error) {
        console.error("wechat-id error:", error);
        res.status(500).json({ message: error.message });
    }
});


// Tạo link mới theo yêu cầu (thay vì auto-renew)
router.post("/:id/generate-link", async (req, res) => {
    try {
        const account = await Account.findById(req.params.id);
        if (!account) return res.status(404).json({ message: "Không tìm thấy" });
        const t = buildTokens();
        account.linkToken          = t.linkToken;
        account.linkTokenExpiresAt = t.linkTokenExpiresAt;
        await account.save();
        if (account.messageToken) {
            pushLinkToWorker(t.linkToken, account.messageToken, t.linkTokenExpiresAt);
        }
        res.json({ linkToken: t.linkToken, linkTokenExpiresAt: t.linkTokenExpiresAt });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.put("/generate-message-tokens", async (req, res) => {
    try {
        const accounts = await Account.find({
            $or: [
                { messageToken: { $exists: false } },
                { messageToken: "" },
                { messageToken: null }
            ]
        });

        let updatedCount = 0;

        for (const account of accounts) {
            account.messageToken = buildTokens().messageToken;
            await account.save();
            updatedCount++;
        }

        res.json({
            message: "Đã cập nhật messageToken cho dữ liệu cũ",
            updatedCount
        });
    } catch (error) {
        console.error("generate-message-tokens error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.post("/import-mail", async (req, res) => {
    try {
        const rows = String(req.body.rows || "").trim();

        if (!rows) {
            return res.status(400).json({ message: "Thiếu dữ liệu import" });
        }

        const lines = rows
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        let created = 0;
        let updated = 0;

        for (const line of lines) {
            const parts = line.split("|").map(x => x.trim());

            const email = normalizeEmail(parts[0] || "");
            const password = String(parts[1] || "").trim();
            const domain = email.split("@")[1] || "";
            const isGmail =
                domain === "gmail.com" || domain === "googlemail.com";

            if (!email || !password) continue;

            let account = await Account.findOne({ email });

            if (!account) {
                const tokens = buildTokens();

                account = new Account({
                    email,
                    password,
                    status: "CHUA BAN",
                    wechatId: "",
                    linkToken: tokens.linkToken,
                    messageToken: tokens.messageToken
                });

                await account.save();
                created++;
            } else {
                account.password = password;
                await account.save();
                updated++;
            }
        }

        res.json({
            message: "Import mail thành công",
            created,
            updated
        });
    } catch (error) {
        console.error("import-mail error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.post("/import-mail-file", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "Không có file được tải lên" });
        }

        const raw = req.file.buffer.toString("utf8").trim();

        if (!raw) {
            return res.status(400).json({ message: "File không có dữ liệu" });
        }

        const lines = raw
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            return res.status(400).json({ message: "File CSV không hợp lệ" });
        }

        const headers = lines[0].split(",").map(x => x.trim().toLowerCase());

        const idx = {
            email: headers.indexOf("email"),
            password: headers.indexOf("password")
        };

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",").map(x => x.trim());

            const email = normalizeEmail(
                idx.email >= 0 ? cols[idx.email] : ""
            );
            const password = String(
                idx.password >= 0 ? cols[idx.password] : ""
            ).trim();

            if (!email || !password) {
                skipped++;
                continue;
            }

            let account = await Account.findOne({ email });

            if (!account) {
                const tokens = buildTokens();

                account = new Account({
                    email,
                    password,
                    status: "CHUA BAN",
                    wechatId: "",
                    linkToken: tokens.linkToken,
                    messageToken: tokens.messageToken
                });

                await account.save();
                created++;
            } else {
                account.password = password;
                await account.save();
                updated++;
            }
        }

        res.json({
            message: "Import CSV thành công",
            created,
            updated,
            skipped
        });
    } catch (error) {
        console.error("import-mail-file error:", error);
        res.status(500).json({ message: error.message });
    }
});

// Cập nhật thông tin người mua
router.put("/buyer/:id", async (req, res) => {
    try {
        const buyerInfo = String(req.body.buyerInfo || "").trim();
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { buyerInfo },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Không tìm thấy account" });
        res.json({ message: "updated", data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Cập nhật ngày đăng ký WeChat (tự động set hôm nay nếu không truyền)
router.put("/wechat-date/:id", async (req, res) => {
    try {
        const wechatCreatedAt = req.body.wechatCreatedAt
            ? new Date(req.body.wechatCreatedAt)
            : new Date();
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { wechatCreatedAt },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Không tìm thấy account" });
        res.json({ message: "updated", data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Bulk sell
router.put("/bulk-sell", async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (!ids.length) return res.status(400).json({ message: "Không có ID nào" });
        const result = await Account.updateMany(
            { _id: { $in: ids } },
            { status: "DA BAN" }
        );
        res.json({ message: "Đã bán", count: result.modifiedCount });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Archive single (soft delete — giữ email trong DB tránh tái sử dụng variant)
router.delete("/:id", async (req, res) => {
    try {
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { archived: true, imapEnabled: false },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Không tìm thấy account" });
        res.json({ message: "Đã lưu trữ" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Bulk archive
router.delete("/bulk", async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (!ids.length) return res.status(400).json({ message: "Không có ID nào" });
        await Account.updateMany({ _id: { $in: ids } }, { archived: true, imapEnabled: false });
        res.json({ message: "Đã lưu trữ", count: ids.length });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Restore single
router.put("/restore/:id", async (req, res) => {
    try {
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { archived: false },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Không tìm thấy account" });
        res.json({ message: "Đã khôi phục", data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Bulk restore
router.put("/restore-bulk", async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (!ids.length) return res.status(400).json({ message: "Không có ID nào" });
        await Account.updateMany({ _id: { $in: ids } }, { archived: false });
        res.json({ message: "Đã khôi phục", count: ids.length });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Hard delete single (xóa cứng — dùng khi chắc chắn không cần nữa)
router.delete("/hard/:id", async (req, res) => {
    try {
        const deleted = await Account.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Không tìm thấy account" });
        await Message.deleteMany({ accountId: req.params.id });
        res.json({ message: "Đã xóa cứng" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Hard delete bulk
router.delete("/hard-bulk", async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (!ids.length) return res.status(400).json({ message: "Không có ID nào" });
        await Account.deleteMany({ _id: { $in: ids } });
        await Message.deleteMany({ accountId: { $in: ids } });
        res.json({ message: "Đã xóa cứng", count: ids.length });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/accounts/google-auth-url
router.get("/google-auth-url", (req, res) => {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) {
        return res.status(400).json({ message: "Thiếu email để xác thực" });
    }

    const clientId = process.env.GMAIL_CLIENT_ID;
    if (!clientId) {
        return res.status(400).json({ message: "Google Client Credentials chưa được cấu hình. Vui lòng thiết lập trong Cài đặt trước." });
    }

    const port = process.env.PORT || 3000;
    const redirectUri = `http://localhost:${port}/api/auth/google/callback`;
    const scope = "https://www.googleapis.com/auth/gmail.readonly";

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}` +
        `&access_type=offline` +
        `&prompt=consent` +
        `&state=${encodeURIComponent(email)}`;

    res.json({ authUrl });
});

module.exports = router;
