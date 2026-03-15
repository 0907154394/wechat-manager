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

async function syncOneAccount(account) {
    const client = new ImapFlow({
        host: account.imapHost,
        port: account.imapPort || 993,
        secure: account.imapSecure !== false,
        auth: {
            user: account.imapUser,
            pass: account.imapPass
        }
    });

    try {
        await client.connect();
        await client.mailboxOpen("INBOX");

        const lock = await client.getMailboxLock("INBOX");

        try {
            const messages = await client.fetchAll("1:*", {
                uid: true,
                envelope: true,
                source: true
            });

            const lastMessages = messages.slice(-20);

            for (const msg of lastMessages) {
                const subject = msg.envelope?.subject || "";
                const sender = msg.envelope?.from?.[0]?.address || "IMAP";
                const content = msg.source
                    ? msg.source.toString("utf8").slice(0, 5000)
                    : "";

                const existed = await Message.findOne({
                    accountId: account._id,
                    subject,
                    sender,
                    content
                });

                if (!existed && content.trim()) {
                    await Message.create({
                        accountId: account._id,
                        sender,
                        subject,
                        content
                    });
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

    for (const account of accounts) {
        try {
            await syncOneAccount(account);
        } catch (err) {
            workerState.lastError = err.message;
            console.error("IMAP sync error:", account.email, err.message);
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