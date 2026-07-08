const https = require("https");
const http  = require("http");
const querystring = require("querystring");
const Account = require("./models/Account");
const Message = require("./models/Message");

// Normalize Gmail local part (xóa dấu chấm)
function normalizeGmailLocal(email) {
    const [local, domain] = email.toLowerCase().split("@");
    if (!domain) return email.toLowerCase();
    if (domain === "gmail.com" || domain === "googlemail.com")
        return local.replace(/\./g, "") + "@" + domain;
    return email.toLowerCase();
}

// Gmail API OAuth and data retrieval helpers
function refreshGoogleToken(refreshToken, clientId, clientSecret) {
    return new Promise((resolve, reject) => {
        const payload = querystring.stringify({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token"
        });

        const req = https.request({
            hostname: "oauth2.googleapis.com",
            path: "/token",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed.error_description || parsed.error || data));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}

function listGmailMessages(accessToken, q = "") {
    return new Promise((resolve, reject) => {
        const path = `/gmail/v1/users/me/messages?maxResults=20` + (q ? `&q=${encodeURIComponent(q)}` : "");
        const req = https.get({
            hostname: "gmail.googleapis.com",
            path: path,
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed.messages || []);
                    } else {
                        reject(new Error(parsed.error?.message || data));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on("error", reject);
    });
}

function getGmailMessageRaw(accessToken, messageId) {
    return new Promise((resolve, reject) => {
        const req = https.get({
            hostname: "gmail.googleapis.com",
            path: `/gmail/v1/users/me/messages/${messageId}?format=raw`,
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed.error?.message || data));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on("error", reject);
    });
}

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
    lastSuccessAt: null,
    activeAccounts: 0,
    intervalId: null,
    watchdogId: null,
    lastError: "",
    accountErrors: {}   // gmailUser (normalized) → error message
};

const WATCHDOG_INTERVAL = 5 * 60 * 1000;  // kiểm tra mỗi 5 phút
const WATCHDOG_TIMEOUT  = 15 * 60 * 1000; // restart nếu không sync được trong 15 phút

// Chỉ hiện lỗi sau 3 lần fail liên tiếp (~1 phút) — tránh báo lỗi transient
const failCounts = new Map(); // gmailUser → số lần fail liên tiếp
const FAIL_THRESHOLD = 3;

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

// Sync a group of accounts that share the same Gmail credentials (base email)
async function syncGroup(groupConfig, accounts) {
    const { baseEmail, refreshToken } = groupConfig;
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Google Client Credentials chưa được thiết lập");
    }

    // 1. Get or refresh access token
    let accessToken = accounts[0].gmailAccessToken;
    let tokenExpiry = accounts[0].gmailTokenExpiry;

    const isExpired = !accessToken || !tokenExpiry || new Date(tokenExpiry).getTime() < Date.now() + 60000;

    if (isExpired) {
        // Refresh token
        const refreshData = await refreshGoogleToken(refreshToken, clientId, clientSecret);
        accessToken = refreshData.access_token;
        const expiresIn = refreshData.expires_in || 3600;
        tokenExpiry = new Date(Date.now() + expiresIn * 1000);

        // Update token cache in all variant accounts in DB
        const accountIds = accounts.map(a => a._id);
        await Account.updateMany(
            { _id: { $in: accountIds } },
            { $set: { gmailAccessToken: accessToken, gmailTokenExpiry: tokenExpiry } }
        );
    }

    // 2. Fetch list of messages (newer than 2 days to keep it fast)
    const messages = await listGmailMessages(accessToken, "newer_than:2d");
    if (!messages || !messages.length) return;

    // Build lookup map for variant accounts
    const accountByEmail = new Map();
    for (const account of accounts) {
        accountByEmail.set(account.email.toLowerCase().trim(), account);
    }

    // RFC2047 MIME Header decoder (e.g. for subjects/senders)
    function decodeRFC2047(str) {
        return str.replace(/=\?([A-Za-z0-9_-]+)\?([QB])\?([^\?]+)\?=/gi, (_, charset, encoding, text) => {
            if (encoding.toUpperCase() === "B") {
                try { return Buffer.from(text, "base64").toString(charset || "utf8"); } catch { return text; }
            } else if (encoding.toUpperCase() === "Q") {
                try {
                    return text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__, hex) =>
                        String.fromCharCode(parseInt(hex, 16))
                    );
                } catch { return text; }
            }
            return text;
        });
    }

    // 3. Process each message
    for (const msgBrief of messages) {
        const msgId = msgBrief.id;

        // Check if all variant accounts in this group already have this message processed
        const existingMessagesCount = await Message.countDocuments({
            accountId: { $in: accounts.map(a => a._id) },
            gmailMsgId: msgId
        });

        if (existingMessagesCount >= accounts.length) {
            continue;
        }

        // Fetch Raw Message
        const msgData = await getGmailMessageRaw(accessToken, msgId);
        if (!msgData || !msgData.raw) continue;

        const rawMime = Buffer.from(msgData.raw, "base64url");
        const content = extractContent(rawMime);
        if (!content.trim()) continue;

        // Parse subject and sender from the raw source
        const rawStr = rawMime.toString("utf8");
        const subjectMatch = rawStr.match(/^Subject:\s*(.+?)(?:\r?\n(?![ \t]))/im);
        const fromMatch = rawStr.match(/^From:\s*(.+?)(?:\r?\n(?![ \t]))/im);
        const toMatch = rawStr.match(/^To:\s*(.+?)(?:\r?\n(?![ \t]))/im);

        let subject = subjectMatch ? subjectMatch[1].trim() : "";
        let sender = fromMatch ? fromMatch[1].trim() : "Gmail API";

        subject = decodeRFC2047(subject);
        sender = decodeRFC2047(sender);

        const senderEmailMatch = sender.match(/<([^>]+)>/);
        if (senderEmailMatch) {
            sender = senderEmailMatch[1];
        }

        // Determine target accounts by matching the To header
        let targetAccounts = [];
        if (toMatch) {
            const rawToLine = toMatch[1];
            const emailsInTo = [...rawToLine.matchAll(/[\w.+%-]+@[\w.-]+\.\w+/g)]
                .map(m => m[0].toLowerCase().trim());
            
            for (const e of emailsInTo) {
                const found = accountByEmail.get(e);
                if (found) targetAccounts.push(found);
            }
        }

        if (targetAccounts.length === 0) continue;

        for (const account of targetAccounts) {
            // Check if Message with gmailMsgId exists for this specific account
            const byGmailId = await Message.findOne({
                accountId: account._id,
                gmailMsgId: msgId
            });

            if (byGmailId) {
                if (isGarbled(byGmailId.content)) {
                    await Message.updateOne(
                        { _id: byGmailId._id },
                        { $set: { content } }
                    );
                }
                continue;
            }

            // Fallback lookup: old messages without gmailMsgId
            const bySubject = await Message.findOneAndUpdate(
                { accountId: account._id, subject, sender, gmailMsgId: null },
                { $set: { gmailMsgId: msgId, content } }
            );

            if (!bySubject) {
                await Message.create({
                    accountId: account._id,
                    sender,
                    subject,
                    content,
                    gmailMsgId: msgId
                });

                // Push new OTP to Cloudflare Worker
                if (account.messageToken) {
                    pushToWorker(account.messageToken, content, account.email);
                }
            }
        }
    }
}

async function runWorkerOnce() {
    // Find all accounts with Gmail API enabled and not archived
    const accounts = await Account.find({
        gmailApiEnabled: true,
        gmailRefreshToken: { $ne: "" },
        archived: { $ne: true }
    });

    workerState.activeAccounts = accounts.length;
    workerState.lastRunAt = new Date().toISOString();
    workerState.lastError = "";

    if (!accounts.length) return;

    // Group accounts by base email (so variants share a single connection/request)
    const groups = new Map();

    for (const account of accounts) {
        const baseEmail = normalizeGmailLocal(account.email);

        if (!groups.has(baseEmail)) {
            groups.set(baseEmail, {
                config: {
                    baseEmail,
                    refreshToken: account.gmailRefreshToken
                },
                accounts: []
            });
        }

        groups.get(baseEmail).accounts.push(account);
    }

    // Run sync in parallel for all groups
    await Promise.allSettled(
        [...groups.values()].map(group =>
            syncGroup(group.config, group.accounts)
                .then(() => {
                    const user = group.config.baseEmail;
                    failCounts.delete(user);
                    delete workerState.accountErrors[user];
                    workerState.lastSuccessAt = new Date().toISOString();
                    Account.find({ gmailApiEnabled: true }).then(allAccs => {
                        const matchingIds = allAccs.filter(a => normalizeGmailLocal(a.email) === user).map(a => a._id);
                        Account.updateMany(
                            { _id: { $in: matchingIds } },
                            { $set: { gmailError: "" } }
                        ).catch(() => {});
                    }).catch(() => {});
                })
                .catch(err => {
                    const user = group.config.baseEmail;
                    const count = (failCounts.get(user) || 0) + 1;
                    failCounts.set(user, count);
                    workerState.lastError = err.message;
                    console.error("Gmail API sync error [%s] (fail %d/%d):", user, count, FAIL_THRESHOLD, err.message);
                    if (count >= FAIL_THRESHOLD) {
                        workerState.accountErrors[user] = err.message;
                        Account.find({ gmailApiEnabled: true }).then(allAccs => {
                            const matchingIds = allAccs.filter(a => normalizeGmailLocal(a.email) === user).map(a => a._id);
                            Account.updateMany(
                                { _id: { $in: matchingIds } },
                                { $set: { gmailError: err.message } }
                            ).catch(() => {});
                        }).catch(() => {});
                    }
                })
        )
    );
}

function startWorker() {
    if (workerState.running) return workerState;

    workerState.running = true;
    workerState.lastError = "";
    workerState.lastSuccessAt = new Date().toISOString(); // khởi tạo để watchdog không restart ngay

    workerState.intervalId = setInterval(async () => {
        try {
            await runWorkerOnce();
        } catch (err) {
            workerState.lastError = err.message;
            console.error("Worker loop error:", err.message);
        }
    }, 20000);

    // Watchdog: tự restart nếu không có sync thành công trong WATCHDOG_TIMEOUT
    workerState.watchdogId = setInterval(() => {
        if (!workerState.running || !workerState.lastSuccessAt) return;
        const elapsed = Date.now() - new Date(workerState.lastSuccessAt).getTime();
        if (elapsed > WATCHDOG_TIMEOUT) {
            console.warn("[Watchdog] Không sync được trong 15 phút — đang tự khởi động lại Gmail API worker...");
            stopWorker();
            startWorker();
        }
    }, WATCHDOG_INTERVAL);

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
    if (workerState.watchdogId) {
        clearInterval(workerState.watchdogId);
        workerState.watchdogId = null;
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
