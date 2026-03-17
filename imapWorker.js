const Account = require("./models/Account");
const Message = require("./models/Message");
const { fetchNewEmails } = require("./services/imapService");
const { buildMessagePayload } = require("./services/parserService");

const state = {
    running: false,
    timer: null,
    intervalMs: 10000,
    activeAccounts: 0,
    lastRunAt: null,
    lastError: ""
};

async function processAccount(account) {
    account.workerStatus = "checking";
    account.workerLastError = "";
    await account.save();

    try {
        const mails = await fetchNewEmails(account);
        let maxUid = Number(account.lastUid || 0);

        for (const mail of mails) {
            const payload = buildMessagePayload(mail.parsed);

            await Message.updateOne(
                {
                    accountId: account._id,
                    uid: mail.uid
                },
                {
                    $setOnInsert: {
                        accountId: account._id,
                        sender: payload.sender,
                        subject: payload.subject,
                        content: payload.content,
                        code: payload.code,
                        uid: mail.uid,
                        rawDate: mail.date || null
                    }
                },
                { upsert: true }
            );

            if (mail.uid > maxUid) {
                maxUid = mail.uid;
            }
        }

        account.lastUid = maxUid;
        account.lastCheckedAt = new Date();
        account.workerStatus = "connected";
        account.workerLastError = "";
        await account.save();
    } catch (error) {
        account.workerStatus = "error";
        account.workerLastError = String(error.message || error);
        account.lastCheckedAt = new Date();
        await account.save();
        throw error;
    }
}

async function tick() {
    if (!state.running) return;

    state.lastRunAt = new Date().toISOString();
    state.lastError = "";

    try {
        const accounts = await Account.find({
            imapEnabled: true,
            imapHost: { $ne: "" },
            imapPass: { $ne: "" }
        });

        state.activeAccounts = accounts.length;

        for (const account of accounts) {
            try {
                await processAccount(account);
            } catch (error) {
                state.lastError = String(error.message || error);
                console.error("IMAP worker account error:", account.email, error.message);
            }
        }
    } catch (error) {
        state.lastError = String(error.message || error);
        console.error("IMAP worker tick error:", error.message);
    }
}

function startWorker() {
    if (state.running) return state;

    state.running = true;
    state.timer = setInterval(() => {
        tick().catch((err) => {
            console.error("worker interval error:", err.message);
        });
    }, state.intervalMs);

    tick().catch((err) => {
        console.error("worker start tick error:", err.message);
    });

    return getStatus();
}

function stopWorker() {
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
    }

    state.running = false;
    return getStatus();
}

async function reloadAccounts() {
    const total = await Account.countDocuments({ imapEnabled: true });
    state.activeAccounts = total;

    return {
        ok: true,
        activeAccounts: total
    };
}

function getStatus() {
    return {
        running: state.running,
        intervalMs: state.intervalMs,
        activeAccounts: state.activeAccounts,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError
    };
}

module.exports = {
    startWorker,
    stopWorker,
    reloadAccounts,
    getStatus
};