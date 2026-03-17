const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

async function fetchNewEmails(account) {
    const client = new ImapFlow({
        host: account.imapHost,
        port: Number(account.imapPort || 993),
        secure: !!account.imapSecure,
        auth: {
            user: account.imapUser || account.email,
            pass: account.imapPass
        },
        logger: false
    });

    const results = [];

    try {
        console.log("Connecting IMAP:", {
            host: account.imapHost,
            port: account.imapPort,
            secure: account.imapSecure,
            user: account.imapUser || account.email
        });

        await client.connect();
        console.log("IMAP connected:", account.email);

        await client.mailboxOpen("INBOX");
        console.log("INBOX opened:", account.email);

        const lastUid = Number(account.lastUid || 0);
        const range = `${lastUid + 1}:*`;

        for await (const msg of client.fetch(range, {
            uid: true,
            source: true,
            internalDate: true
        })) {
            let parsed;

            try {
                parsed = await simpleParser(msg.source);
            } catch {
                parsed = {
                    subject: "",
                    text: "",
                    html: "",
                    from: { text: "" }
                };
            }

            results.push({
                uid: msg.uid,
                date: msg.internalDate || null,
                parsed
            });
        }

        console.log("Fetched mails count:", results.length);

        await client.logout();
        console.log("IMAP logout:", account.email);

        return results;
    } catch (error) {
        console.error("IMAP REAL ERROR:", error);
        console.error("IMAP REAL ERROR MESSAGE:", error?.message);
        console.error("IMAP REAL ERROR RESPONSE:", error?.response);
        console.error("IMAP REAL ERROR STACK:", error?.stack);

        try {
            await client.logout();
        } catch {}

        throw error;
    }
}

module.exports = {
    fetchNewEmails
};