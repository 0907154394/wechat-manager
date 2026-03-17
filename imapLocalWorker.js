require("dotenv").config();

const mongoose = require("mongoose");
const Account = require("./models/Account");
const Message = require("./models/Message");

const { fetchNewEmails } = require("./services/imapService");
const { buildMessagePayload } = require("./services/parserService");

async function connectDB() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");
}

async function processAccount(account) {
    console.log("Checking:", account.email);

    const mails = await fetchNewEmails(account);
    let maxUid = Number(account.lastUid || 0);

    for (const mail of mails) {
        const payload = buildMessagePayload(mail.parsed);

        console.log("Saving mail UID:", mail.uid);
        console.log("Subject:", payload.subject);
        console.log("Code:", payload.code);

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

        console.log("Saved UID:", mail.uid);

        if (mail.uid > maxUid) {
            maxUid = mail.uid;
        }
    }

    account.lastUid = maxUid;
    account.lastCheckedAt = new Date();
    account.workerStatus = "connected";
    account.workerLastError = "";
    await account.save();

    console.log("Done:", account.email);
}

async function runWorker() {
    const accounts = await Account.find({
        imapEnabled: true
    });

    for (const account of accounts) {
        try {
            await processAccount(account);
        } catch (err) {
            account.workerStatus = "error";
            account.workerLastError = err.message || String(err);
            account.lastCheckedAt = new Date();
            await account.save();

            console.log("Account error:", err.message);
        }
    }
}

async function start() {
    await connectDB();

    console.log("IMAP worker started");

    setInterval(async () => {
        try {
            console.log("Checking mail...");
            await runWorker();
        } catch (err) {
            console.log("Worker error:", err.message);
        }
    }, 15000);
}

start();