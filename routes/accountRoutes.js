const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const Account = require("../models/Account");
const Message = require("../models/Message");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function newToken(len = 16) {
    return uuidv4().replace(/-/g, "").slice(0, len);
}

function buildTokens() {
    return {
        linkToken: newToken(16),
        messageToken: newToken(20)
    };
}

function ensureAccountTokens(account) {
    let changed = false;

    if (account.linkToken && String(account.linkToken).startsWith("/m/")) {
        account.linkToken = String(account.linkToken).replace(/^\/m\//, "");
        changed = true;
    }

    if (!account.linkToken || !String(account.linkToken).trim()) {
        account.linkToken = newToken(16);
        changed = true;
    }

    if (!account.messageToken || !String(account.messageToken).trim()) {
        account.messageToken = newToken(20);
        changed = true;
    }

    return changed;
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

router.post("/create-bulk", async (req, res) => {
    try {
        const baseEmail = normalizeEmail(req.body.baseEmail);
        const password = String(req.body.password || "").trim();
        const quantity = Number.parseInt(req.body.quantity, 10);

        if (!baseEmail || !baseEmail.includes("@")) {
            return res.status(400).json({ message: "Email gốc không hợp lệ" });
        }

        if (!password) {
            return res.status(400).json({ message: "Mật khẩu không được để trống" });
        }

        if (Number.isNaN(quantity) || quantity < 1) {
            return res.status(400).json({ message: "Số lượng không hợp lệ" });
        }

        const [localPart, domain] = baseEmail.split("@");

        if (!localPart || !domain) {
            return res.status(400).json({ message: "Email gốc không hợp lệ" });
        }

        const variants = generateDotVariants(localPart);

        if (!variants.length) {
            return res.status(400).json({
                message: "Phần trước @ quá ngắn, không có biến thể dấu chấm để tạo"
            });
        }

        const allEmails = variants.map((v) => `${v}@${domain}`);

        const existing = await Account.find({
            email: { $in: allEmails }
        }).select("email");

        const existingSet = new Set(existing.map((x) => normalizeEmail(x.email)));
        const docsToInsert = [];

        for (const local of variants) {
            if (docsToInsert.length >= quantity) break;

            const email = `${local}@${domain}`;
            if (existingSet.has(normalizeEmail(email))) continue;

            const tokens = buildTokens();

            docsToInsert.push({
                email,
                password,
                status: "CHUA BAN",
                wechatId: "",
                linkToken: tokens.linkToken,
                messageToken: tokens.messageToken
            });
        }

        if (!docsToInsert.length) {
            return res.status(400).json({
                message: "Không còn biến thể mới để tạo hoặc tất cả đã tồn tại"
            });
        }

        const inserted = await Account.insertMany(docsToInsert);

        return res.json({
            success: true,
            count: inserted.length,
            data: inserted
        });
    } catch (error) {
        console.error("create-bulk error:", error);
        return res.status(500).json({ message: error.message });
    }
});

router.get("/", async (req, res) => {
    try {
        const accounts = await Account.find().sort({ createdAt: -1 });

        const docsNeedSave = [];
        for (const account of accounts) {
            if (ensureAccountTokens(account)) {
                docsNeedSave.push(account.save());
            }
        }

        if (docsNeedSave.length) {
            await Promise.all(docsNeedSave);
        }

        const refreshedAccounts = await Account.find().sort({ createdAt: -1 });
        return res.json(refreshedAccounts);
    } catch (error) {
        console.error("get accounts error:", error);
        return res.status(500).json({ message: error.message });
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

        return res.json({ success: true, message: "updated", data: updated });
    } catch (error) {
        console.error("sell error:", error);
        return res.status(500).json({ message: error.message });
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

        return res.json({ success: true, message: "updated", data: updated });
    } catch (error) {
        console.error("unsell error:", error);
        return res.status(500).json({ message: error.message });
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

        return res.json({ success: true, message: "updated", data: updated });
    } catch (error) {
        console.error("wechat-id error:", error);
        return res.status(500).json({ message: error.message });
    }
});

router.put("/change-link/:id", async (req, res) => {
    try {
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { linkToken: newToken(16) },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        return res.json({
            success: true,
            message: "Đổi link thành công",
            data: updated
        });
    } catch (error) {
        console.error("change-link error:", error);
        return res.status(500).json({ message: error.message });
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
            account.messageToken = newToken(20);
            ensureAccountTokens(account);
            await account.save();
            updatedCount++;
        }

        return res.json({
            success: true,
            message: "Đã cập nhật token cho dữ liệu cũ",
            updatedCount
        });
    } catch (error) {
        console.error("generate-message-tokens error:", error);
        return res.status(500).json({ message: error.message });
    }
});

router.put("/fix-link-tokens", async (req, res) => {
    try {
        const accounts = await Account.find();
        let fixed = 0;

        for (const account of accounts) {
            if (account.linkToken && String(account.linkToken).startsWith("/m/")) {
                account.linkToken = String(account.linkToken).replace(/^\/m\//, "");
                await account.save();
                fixed++;
            }
        }

        return res.json({
            success: true,
            message: "Đã sửa format linkToken cũ",
            fixed
        });
    } catch (error) {
        console.error("fix-link-tokens error:", error);
        return res.status(500).json({ message: error.message });
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
            .map((x) => x.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            return res.status(400).json({ message: "File CSV không hợp lệ" });
        }

        const headers = lines[0].split(",").map((x) => x.trim().toLowerCase());

        const idx = {
            email: headers.indexOf("email"),
            password: headers.indexOf("password"),
            imapHost: headers.indexOf("imaphost"),
            imapPort: headers.indexOf("imapport"),
            imapUser: headers.indexOf("imapuser"),
            imapPass: headers.indexOf("imappass"),
            imapSecure: headers.indexOf("imapsecure")
        };

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",").map((x) => x.trim());

            const email = normalizeEmail(idx.email >= 0 ? cols[idx.email] : "");
            const password = String(idx.password >= 0 ? cols[idx.password] : "").trim();
            const imapHost = String(idx.imapHost >= 0 ? cols[idx.imapHost] : "").trim();
            const imapPort = Number(idx.imapPort >= 0 ? cols[idx.imapPort] : 993);
            const imapUser = String(idx.imapUser >= 0 ? cols[idx.imapUser] : email).trim();
            const imapPass = String(idx.imapPass >= 0 ? cols[idx.imapPass] : password).trim();
            const secureRaw = String(
                idx.imapSecure >= 0 ? cols[idx.imapSecure] : "true"
            ).toLowerCase();

            const imapSecure =
                secureRaw === "true" || secureRaw === "1" || secureRaw === "yes";

            if (!email || !password || !imapHost) {
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
                    messageToken: tokens.messageToken,
                    imapHost,
                    imapPort,
                    imapSecure,
                    imapUser,
                    imapPass,
                    imapEnabled: true
                });

                await account.save();
                created++;
            } else {
                account.password = password;
                account.imapHost = imapHost;
                account.imapPort = imapPort;
                account.imapSecure = imapSecure;
                account.imapUser = imapUser;
                account.imapPass = imapPass;
                account.imapEnabled = true;

                ensureAccountTokens(account);

                await account.save();
                updated++;
            }
        }

        return res.json({
            success: true,
            message: "Import CSV thành công",
            created,
            updated,
            skipped
        });
    } catch (error) {
        console.error("import-mail-file error:", error);
        return res.status(500).json({ message: error.message });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const accountId = req.params.id;

        const deleted = await Account.findByIdAndDelete(accountId);

        if (!deleted) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        await Message.deleteMany({ accountId });

        return res.json({
            success: true,
            message: "Đã xóa account và toàn bộ tin nhắn liên quan"
        });
    } catch (error) {
        console.error("delete account error:", error);
        return res.status(500).json({ message: error.message });
    }
});

module.exports = router;