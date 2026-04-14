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

const LINK_TTL_MS = 20 * 60 * 1000; // 20 phút

function buildTokens() {
    return {
        linkToken: "/m/" + uuidv4().replace(/-/g, "").substring(0, 16),
        linkTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS),
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
        const gmailAppPassword = String(req.body.gmailAppPassword || "").replace(/\s/g, "");

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

        // Nếu không nhập App Password mới, thử lấy IMAP config từ variant cũ cùng Gmail gốc
        let inheritedImap = null;
        if (isGmail && !gmailAppPassword) {
            const prev = await Account.findOne({
                imapUser: baseEmail,
                imapEnabled: true,
                imapPass: { $ne: "" }
            }).select("imapHost imapPort imapSecure imapUser imapPass");
            if (prev) {
                inheritedImap = {
                    imapHost:    prev.imapHost,
                    imapPort:    prev.imapPort,
                    imapSecure:  prev.imapSecure,
                    imapUser:    prev.imapUser,
                    imapPass:    prev.imapPass,
                    imapEnabled: true
                };
            }
        }

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

            if (isGmail && gmailAppPassword) {
                // App Password mới được cung cấp
                doc.imapHost    = "imap.gmail.com";
                doc.imapPort    = 993;
                doc.imapSecure  = true;
                doc.imapUser    = baseEmail;
                doc.imapPass    = gmailAppPassword;
                doc.imapEnabled = true;
            } else if (inheritedImap) {
                // Tái sử dụng IMAP config từ variant cũ cùng Gmail gốc
                Object.assign(doc, inheritedImap);
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
        const showArchived = req.query.archived === "true";
        const query = showArchived ? { archived: true } : { archived: { $ne: true } };
        const accounts = await Account.find(query).sort({ createdAt: -1 });
        const now = Date.now();
        const renewOps = [];

        for (const a of accounts) {
            const expired = !a.linkTokenExpiresAt || a.linkTokenExpiresAt.getTime() < now;
            if (expired) {
                const t = buildTokens();
                a.linkToken = t.linkToken;
                a.linkTokenExpiresAt = t.linkTokenExpiresAt;
                renewOps.push(
                    Account.updateOne({ _id: a._id }, {
                        linkToken: t.linkToken,
                        linkTokenExpiresAt: t.linkTokenExpiresAt
                    })
                );
            }
        }

        if (renewOps.length) await Promise.all(renewOps);

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

// Cập nhật IMAP cho TẤT CẢ accounts có cùng imapUser (cùng Gmail gốc)
router.put("/update-imap-bulk", async (req, res) => {
    try {
        const imapUser = String(req.body.imapUser || "").trim().toLowerCase();
        const imapPass = String(req.body.imapPass || "").replace(/\s/g, "");
        const imapHost = String(req.body.imapHost || "imap.gmail.com").trim();
        const imapPort = Number(req.body.imapPort || 993);
        const imapSecure = req.body.imapSecure !== false;

        if (!imapUser || !imapPass) {
            return res.status(400).json({ message: "Thiếu imapUser hoặc imapPass" });
        }

        // Normalize Gmail: xóa dấu chấm để so sánh variants
        function normalizeGmailLocal(email) {
            const [local, domain] = email.toLowerCase().split("@");
            if (!domain) return email.toLowerCase();
            if (domain === "gmail.com" || domain === "googlemail.com")
                return local.replace(/\./g, "") + "@" + domain;
            return email.toLowerCase();
        }

        const normalizedUser = normalizeGmailLocal(imapUser);

        // Lấy tất cả accounts, lọc các cái có email là variant của imapUser
        const allAccounts = await Account.find({});
        const matchIds = allAccounts
            .filter(a => normalizeGmailLocal(a.email) === normalizedUser)
            .map(a => a._id);

        if (!matchIds.length) {
            return res.status(404).json({ message: "Không tìm thấy tài khoản nào phù hợp" });
        }

        await Account.updateMany(
            { _id: { $in: matchIds } },
            { imapHost, imapPort, imapSecure, imapUser, imapPass, imapEnabled: true }
        );

        res.json({ message: `Đã cập nhật IMAP cho ${matchIds.length} tài khoản`, count: matchIds.length });
    } catch (error) {
        console.error("update-imap-bulk error:", error);
        res.status(500).json({ message: error.message });
    }
});

router.put("/update-imap/:id", async (req, res) => {
    try {
        const imapUser = String(req.body.imapUser || "").trim();
        const imapPass = String(req.body.imapPass || "").replace(/\s/g, "");
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
            const rawPort2 = Number(parts[3] || 993);
            const imapPort = (Number.isInteger(rawPort2) && rawPort2 > 0 && rawPort2 < 65536) ? rawPort2 : 993;
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
            const rawPort = Number(idx.imapPort >= 0 ? cols[idx.imapPort] : 993);
            const imapPort = (Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536) ? rawPort : 993;
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

module.exports = router;
