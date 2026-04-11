const express = require("express");
const router = express.Router();
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const Account = require("../models/Account");
const Message = require("../models/Message");

const upload = multer({ storage: multer.memoryStorage() });

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function buildTokens() {
    return {
        linkToken: "/m/" + uuidv4().replace(/-/g, "").substring(0, 16),
        messageToken: uuidv4().replace(/-/g, "").substring(0, 20)
    };
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
// For Gmail: pass gmailAppPassword to auto-configure IMAP on all variants.
// All variants share the same IMAP inbox (Gmail ignores dots), so imapUser
// is set to the BASE email (not the variant) for correct IMAP login.
router.post("/create-bulk", async (req, res) => {
    try {
        const baseEmail = normalizeEmail(req.body.baseEmail);
        const password = String(req.body.password || "").trim();
        const quantity = Number.parseInt(req.body.quantity, 10);
        const gmailAppPassword = String(req.body.gmailAppPassword || "").trim();

        if (!baseEmail || !baseEmail.includes("@")) {
            return res.status(400).json({ message: "Email gốc không hợp lệ" });
        }

        if (Number.isNaN(quantity) || quantity < 1) {
            return res.status(400).json({ message: "Số lượng không hợp lệ" });
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

            // Auto-configure Gmail IMAP if App Password provided
            if (isGmail && gmailAppPassword) {
                doc.imapHost = "imap.gmail.com";
                doc.imapPort = 993;
                doc.imapSecure = true;
                // IMPORTANT: Gmail login uses the base email (dots are ignored by Gmail)
                doc.imapUser = baseEmail;
                doc.imapPass = gmailAppPassword;
                doc.imapEnabled = true;
            }

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
        const accounts = await Account.find().sort({ createdAt: -1 });
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

router.put("/update-imap/:id", async (req, res) => {
    try {
        const imapUser = String(req.body.imapUser || "").trim();
        const imapPass = String(req.body.imapPass || "").trim();
        const imapHost = String(req.body.imapHost || "imap.gmail.com").trim();
        const imapPort = Number(req.body.imapPort || 993);
        const imapSecure = req.body.imapSecure !== false;

        if (!imapUser || !imapPass) {
            return res.status(400).json({ message: "Thiếu imapUser hoặc imapPass" });
        }

        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { imapHost, imapPort, imapSecure, imapUser, imapPass, imapEnabled: true },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        res.json({ message: "Đã cập nhật IMAP", data: updated });
    } catch (error) {
        console.error("update-imap error:", error);
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

router.put("/change-link/:id", async (req, res) => {
    try {
        const updated = await Account.findByIdAndUpdate(
            req.params.id,
            { linkToken: buildTokens().linkToken },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        res.json(updated);
    } catch (error) {
        console.error("change-link error:", error);
        res.status(500).json({ message: error.message });
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

            // Auto-fill Gmail IMAP settings if not provided
            const imapHost = String(parts[2] || "").trim() ||
                (isGmail ? "imap.gmail.com" : "");
            const imapPort = Number(parts[3] || (isGmail ? 993 : 993));
            const imapUser = String(parts[4] || email).trim();
            const imapPass = String(parts[5] || password).trim();
            const secureRaw = String(parts[6] || "true").toLowerCase();
            const imapSecure = secureRaw === "true";

            if (!email || !password || !imapHost) continue;

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
            const cols = lines[i].split(",").map(x => x.trim());

            const email = normalizeEmail(
                idx.email >= 0 ? cols[idx.email] : ""
            );
            const password = String(
                idx.password >= 0 ? cols[idx.password] : ""
            ).trim();
            const domain = email.split("@")[1] || "";
            const isGmail =
                domain === "gmail.com" || domain === "googlemail.com";

            const imapHost =
                String(idx.imapHost >= 0 ? cols[idx.imapHost] : "").trim() ||
                (isGmail ? "imap.gmail.com" : "");
            const imapPort = Number(
                idx.imapPort >= 0 ? cols[idx.imapPort] : (isGmail ? 993 : 993)
            );
            const imapUser = String(
                idx.imapUser >= 0 ? cols[idx.imapUser] : email
            ).trim();
            const imapPass = String(
                idx.imapPass >= 0 ? cols[idx.imapPass] : password
            ).trim();
            const secureRaw = String(
                idx.imapSecure >= 0 ? cols[idx.imapSecure] : "true"
            ).toLowerCase();
            const imapSecure =
                secureRaw === "true" ||
                secureRaw === "1" ||
                secureRaw === "yes";

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

router.delete("/:id", async (req, res) => {
    try {
        const accountId = req.params.id;

        const deleted = await Account.findByIdAndDelete(accountId);

        if (!deleted) {
            return res.status(404).json({ message: "Không tìm thấy account" });
        }

        await Message.deleteMany({ accountId });

        res.json({
            message: "Đã xóa account và toàn bộ tin nhắn liên quan"
        });
    } catch (error) {
        console.error("delete account error:", error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
