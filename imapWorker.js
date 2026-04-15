const { ImapFlow } = require("imapflow");
const https = require("https");
const http  = require("http");
const Account = require("./models/Account");
const Message = require("./models/Message");

// ── Push OTP lên Cloudflare Worker ────────────────────────────────────────
function pushToWorker(messageToken, content, email) {
    const workerUrl = process.env.WORKER_URL;
    const secret    = process.env.WORKER_SECRET;
    if (!workerUrl || !secret) return; // Worker chưa cấu hình → bỏ qua

    try {
        const parsed  = new URL(workerUrl + "/api/push");
        const payload = Buffer.from(JSON.stringify({ messageToken, content, email }));
        const lib     = parsed.protocol === "https:" ? https : http;

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
        req.on("error", () => {}); // fire and forget
        req.write(payload);
        req.end();
    } catch { /* ignore */ }
}

let workerState = {
    running: false,
    lastRunAt: null,
    activeAccounts: 0,
    intervalId: null,
    lastError: "",
    accountErrors: {}   // imapUser → error message
};

// Decode base64 email body (handles line-wrapped base64)
function decodeBase64Body(str) {
    try {
        const clean = str.replace(/\s+/g, "");
        return Buffer.from(clean, "base64").toString("utf8");
    } catch {
        return str;
    }
}

// Decode quoted-printable encoding
function decodeQP(str) {
    return str
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        );
}

// Parse headers block → { contentType, encoding, boundary }
function parseHeaders(headerBlock) {
    // Unfold folded headers (continuation lines starting with \t or space)
    const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
    const ctM   = unfolded.match(/Content-Type:\s*([^\s;]+)/i);
    const cteM  = unfolded.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const bndM  = unfolded.match(/boundary\s*=\s*["']?([^"'\r\n;]+)/i);
    return {
        contentType: ctM  ? ctM[1].toLowerCase()  : "",
        encoding:    cteM ? cteM[1].toLowerCase()  : "7bit",
        boundary:    bndM ? bndM[1].trim().replace(/["']/g, "") : ""
    };
}

// Decode a MIME body part based on its Content-Transfer-Encoding
function decodePart(body, encoding) {
    if (encoding === "base64")             return decodeBase64Body(body);
    if (encoding === "quoted-printable")   return decodeQP(body);
    return body; // 7bit / 8bit / binary
}

// Extract readable plain text from a multipart MIME structure (recursive)
function extractFromMultipart(raw, boundary) {
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    // Split on boundary lines
    const parts = raw.split(new RegExp(`\r?\n?--${escaped}(?:--)?[ \t]*\r?\n`, "g")).slice(1);

    let htmlFallback = "";

    for (const part of parts) {
        const blankIdx = part.search(/\r?\n\r?\n/);
        if (blankIdx < 0) continue;

        const headerBlock = part.substring(0, blankIdx);
        const body        = part.substring(blankIdx).replace(/^\r?\n|\r?\n$/, "").trim();
        if (!body) continue;

        const { contentType, encoding, boundary: inner } = parseHeaders(headerBlock);

        // Recurse into nested multipart
        if (contentType.startsWith("multipart/") && inner) {
            const result = extractFromMultipart(body, inner);
            if (result) return result;
            continue;
        }

        if (contentType === "text/plain") {
            const decoded = decodePart(body, encoding).trim();
            if (decoded) return decoded;
        }

        if (contentType === "text/html" && !htmlFallback) {
            const decoded = decodePart(body, encoding);
            htmlFallback = decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
    }

    return htmlFallback;
}

// Extract readable text from raw email source
function extractContent(source) {
    const raw = source.toString("utf8");

    // Find end of top-level headers
    const headerEnd = raw.search(/\r?\n\r?\n/);
    if (headerEnd < 0) return raw.slice(0, 3000);

    const topHeaders = raw.substring(0, headerEnd);
    const { contentType, encoding, boundary } = parseHeaders(topHeaders);

    // Multipart email → use boundary-based parser
    if (contentType.startsWith("multipart/") && boundary) {
        const result = extractFromMultipart(raw.substring(headerEnd + 2), boundary);
        if (result) return result.slice(0, 3000);
    }

    // Single-part email
    const body = raw.substring(headerEnd + 2).trim();

    if (contentType === "text/plain") {
        const decoded = decodePart(body, encoding).trim();
        if (decoded) return decoded.slice(0, 3000);
    }

    if (contentType === "text/html") {
        const decoded = decodePart(body, encoding);
        const stripped = decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (stripped) return stripped.slice(0, 3000);
    }

    // Last resort: return raw body
    return body.slice(0, 3000);
}

// Detect content saved before the MIME parser was fixed:
// raw base64 lines or leaked MIME headers.
function isGarbled(content) {
    if (!content || !content.trim()) return true;
    if (/^Content-Type:/im.test(content)) return true;
    if (/^Content-Transfer-Encoding:/im.test(content)) return true;
    // Long unbroken base64-alphabet lines (>= 40 chars, no spaces)
    if (/^[A-Za-z0-9+/]{40,}={0,2}\s*$/m.test(content)) return true;
    // MIME boundary lines (e.g. ------=_NextPart_..., --Apple-Mail-..., etc.)
    if (/^-{4,}[A-Za-z0-9_=]+/m.test(content)) return true;
    return false;
}

// Sync a group of accounts that share the same IMAP credentials.
// For Gmail: all dot-variants of the same base Gmail share one connection.
// We match each message to an account by checking the "To:" header.
async function syncGroup(imapConfig, accounts) {
    const client = new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port,
        secure: imapConfig.secure,
        auth: {
            user: imapConfig.user,
            pass: imapConfig.pass
        },
        logger: false,
        socketTimeout: 30000,    // 30s không nhận dữ liệu → cắt kết nối
        connectionTimeout: 15000 // 15s không connect được → báo lỗi
    });

    // Bắt lỗi socket bắn ra ngoài Promise (timer callbacks) — tránh crash Electron
    client.on("error", err => {
        console.error("IMAP client error [%s]:", imapConfig.user, err.message);
    });

    try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
            // Search messages from last 60 days to avoid fetching huge inboxes
            const since = new Date();
            since.setDate(since.getDate() - 60);

            let uids = [];
            try {
                uids = await client.search({ since });
            } catch {
                // If search fails, fall back to all
                uids = await client.search({ all: true });
            }

            if (!uids.length) return;

            // Only take the latest 100 messages
            const targetUids = uids.slice(-100);

            const messages = [];
            for await (const msg of client.fetch(targetUids, {
                uid: true,
                envelope: true,
                source: true
            })) {
                messages.push(msg);
            }

            // Build lookup: exact lowercase email → account
            // Do NOT normalize here — WeChat sends to the specific variant address
            // e.g. "t.hienzx9@gmail.com" → only that account, not all variants
            const accountByEmail = new Map();
            for (const account of accounts) {
                accountByEmail.set(account.email.toLowerCase().trim(), account);
            }

            for (const msg of messages) {
                const subject = msg.envelope?.subject || "";
                const sender = msg.envelope?.from?.[0]?.address || "IMAP";
                const content = msg.source ? extractContent(msg.source) : "";

                if (!content.trim()) continue;

                // Match by exact To: address (case-insensitive)
                // Fallback: parse raw To: header nếu envelope bị normalize
                const toAddrs = msg.envelope?.to || [];
                let targetAccounts = [];

                for (const addr of toAddrs) {
                    const addrLower = (addr.address || "").toLowerCase().trim();
                    const found = accountByEmail.get(addrLower);
                    if (found) targetAccounts.push(found);
                }

                // Fallback: nếu envelope.to không khớp, đọc header To: từ raw source
                if (targetAccounts.length === 0 && msg.source) {
                    const rawStr = msg.source.toString("utf8", 0, 2000);
                    const toHeaderMatch = rawStr.match(/^To:\s*(.+?)(?:\r?\n(?![ \t]))/im);
                    if (toHeaderMatch) {
                        const rawToLine = toHeaderMatch[1];
                        // Trích tất cả địa chỉ email trong dòng To:
                        const emailsInTo = [...rawToLine.matchAll(/[\w.+%-]+@[\w.-]+\.\w+/g)]
                            .map(m => m[0].toLowerCase());
                        for (const e of emailsInTo) {
                            const found = accountByEmail.get(e);
                            if (found) targetAccounts.push(found);
                        }
                    }
                }

                // Nếu vẫn không khớp (BCC, forward...) → bỏ qua
                if (targetAccounts.length === 0) continue;

                for (const account of targetAccounts) {
                    // Step 1: check by IMAP UID
                    const byUid = await Message.findOne({
                        accountId: account._id,
                        imapUid: msg.uid
                    });

                    if (byUid) {
                        // Content may be garbled from before MIME parser was fixed.
                        // Overwrite if it still contains leaked MIME headers or raw base64.
                        if (isGarbled(byUid.content)) {
                            await Message.updateOne(
                                { _id: byUid._id },
                                { $set: { content } }
                            );
                        }
                        continue;
                    }

                    // Step 2: old messages without imapUid — stamp uid + refresh content
                    const bySubject = await Message.findOneAndUpdate(
                        { accountId: account._id, subject, sender, imapUid: null },
                        { $set: { imapUid: msg.uid, content } }
                    );

                    if (!bySubject) {
                        await Message.create({
                            accountId: account._id,
                            sender,
                            subject,
                            content,
                            imapUid: msg.uid
                        });
                        // Đẩy OTP mới lên Cloudflare Worker
                        if (account.messageToken) {
                            pushToWorker(account.messageToken, content, account.email);
                        }
                    }
                }
            }
        } finally {
            lock.release();
        }
    } finally {
        await client.logout().catch(() => {});
    }
}

async function runWorkerOnce() {
    // Sync tất cả acc có IMAP bật và chưa lưu trữ.
    // Không lọc theo status vì acc CHUA BAN vẫn cần OTP khi đang đăng ký WeChat.
    // Tiết kiệm tài nguyên thực sự là giảm số Gmail gốc (IMAP connections),
    // không phải số variants — các variants cùng gốc dùng chung 1 kết nối.
    const accounts = await Account.find({
        imapEnabled: true,
        imapHost: { $ne: "" },
        imapUser: { $ne: "" },
        imapPass: { $ne: "" },
        archived: { $ne: true }
    });

    workerState.activeAccounts = accounts.length;
    workerState.lastRunAt = new Date().toISOString();
    workerState.lastError = "";

    if (!accounts.length) return;

    // Group accounts by IMAP credentials (host + user + pass)
    // This allows Gmail dot-variants to share one IMAP connection
    const groups = new Map();

    for (const account of accounts) {
        const key = `${account.imapHost}|${account.imapPort}|${account.imapUser}|${account.imapPass}`;

        if (!groups.has(key)) {
            groups.set(key, {
                config: {
                    host: account.imapHost,
                    port: account.imapPort || 993,
                    secure: account.imapSecure !== false,
                    user: account.imapUser,
                    pass: account.imapPass
                },
                accounts: []
            });
        }

        groups.get(key).accounts.push(account);
    }

    // Run all IMAP groups in parallel — total time = slowest group, not sum of all
    await Promise.allSettled(
        [...groups.values()].map(group =>
            syncGroup(group.config, group.accounts)
                .then(() => {
                    delete workerState.accountErrors[group.config.user];
                })
                .catch(err => {
                    workerState.lastError = err.message;
                    workerState.accountErrors[group.config.user] = err.message;
                    console.error("IMAP sync error [%s]:", group.config.user, err.message);
                })
        )
    );
}

function startWorker() {
    if (workerState.running) return workerState;

    workerState.running = true;
    workerState.lastError = "";

    workerState.intervalId = setInterval(async () => {
        try {
            await runWorkerOnce();
        } catch (err) {
            workerState.lastError = err.message;
            console.error("Worker loop error:", err.message);
        }
    }, 20000);

    runWorkerOnce().catch(err => {
        workerState.lastError = err.message;
        console.error("Initial worker run error:", err.message);
    });

    return workerState;
}

function stopWorker() {
    if (workerState.intervalId) {
        clearInterval(workerState.intervalId);
        workerState.intervalId = null;
    }

    workerState.running = false;
    return workerState;
}

async function reloadAccounts() {
    await runWorkerOnce();
    return workerState;
}

function getWorkerStatus() {
    return workerState;
}

module.exports = {
    startWorker,
    stopWorker,
    reloadAccounts,
    getWorkerStatus
};
