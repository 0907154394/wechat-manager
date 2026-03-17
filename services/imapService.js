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
        await client.connect();
        await client.mailboxOpen("INBOX");

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

        await client.logout();
        return results;
    } catch (error) {
        try {
            await client.logout();
        } catch {}
        throw error;
    }
}

module.exports = {
    fetchNewEmails
};