const { ImapFlow } = require("imapflow");
const Account = require("./models/Account");
const Message = require("./models/Message");

let workerState = {
    running: false,
    lastRunAt: null,
    activeAccounts: 0,
    intervalId: null,
    lastError: ""
};

// Normalize Gmail address: remove dots from local part, strip +alias
// e.g. a.bc+wechat@gmail.com → abc@gmail.com
function normalizeGmail(email) {
    const str = String(email || "").toLowerCase().trim();
    const atIdx = str.lastIndexOf("@");
    if (atIdx < 0) return str;

    const local = str.substring(0, atIdx);
    const domain = str.substring(atIdx + 1);

    if (domain === "gmail.com" || domain === "googlemail.com") {
        const normalized = local.replace(/\./g, "").split("+")[0];
        return `${normalized}@${domain}`;
    }

    return str;
}

// Extract readable text from raw email source (no external libs)
function extractContent(source) {
    const raw = source.toString("utf8");

    // Try to find text/plain section in MIME
    const plainMatch = raw.match(
        /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:[A-Za-z-]+:[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\r?\n--|$)/i
    );
    if (plainMatch && plainMatch[1].trim()) {
        return plainMatch[1].trim().slice(0, 3000);
    }

    // Fallback: body after headers double-blank-line
    const idx = raw.search(/\r?\n\r?\n/);
    if (idx >= 0) {
        const body = raw.substring(idx + 2).slice(0, 3000);
        return body.trim() || raw.slice(0, 3000);
    }

    return raw.slice(0, 3000);
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
        logger: false
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

            // Build lookup: normalized email → account
            const accountByNorm = new Map();
            for (const account of accounts) {
                accountByNorm.set(normalizeGmail(account.email), account);
            }

            for (const msg of messages) {
                const subject = msg.envelope?.subject || "";
                const sender = msg.envelope?.from?.[0]?.address || "IMAP";
                const content = msg.source ? extractContent(msg.source) : "";

                if (!content.trim()) continue;

                // Determine which account(s) this email belongs to via To: header
                const toAddrs = msg.envelope?.to || [];
                let targetAccounts = [];

                for (const addr of toAddrs) {
                    const norm = normalizeGmail(addr.address || "");
                    const found = accountByNorm.get(norm);
                    if (found) targetAccounts.push(found);
                }

                // If To: didn't match any known account, save to all in this group
                // (handles cases where email was forwarded or BCC'd)
                if (targetAccounts.length === 0) {
                    targetAccounts = accounts;
                }

                for (const account of targetAccounts) {
                    const existed = await Message.findOne({
                        accountId: account._id,
                        subject,
                        sender
                    });

                    if (!existed) {
                        await Message.create({
                            accountId: account._id,
                            sender,
                            subject,
                            content
                        });
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
    const accounts = await Account.find({
        imapEnabled: true,
        imapHost: { $ne: "" },
        imapUser: { $ne: "" },
        imapPass: { $ne: "" }
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

    for (const [, group] of groups) {
        try {
            await syncGroup(group.config, group.accounts);
        } catch (err) {
            workerState.lastError = err.message;
            console.error(
                "IMAP sync error [%s]:",
                group.config.user,
                err.message
            );
        }
    }
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
    }, 30000);

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
