const { ImapFlow } = require("imapflow");

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
            envelope: true,
            source: true,
            internalDate: true,
            bodyStructure: true
        })) {
            const parsed = {
                uid: msg.uid,
                date: msg.internalDate || null,
                subject: msg.envelope?.subject || "",
                from: {
                    name: msg.envelope?.from?.[0]?.name || "",
                    address: msg.envelope?.from?.[0]?.address || ""
                },
                text: ""
            };

            try {
                const sourceText = msg.source ? msg.source.toString("utf8") : "";
                parsed.text = sourceText;
            } catch {
                parsed.text = "";
            }

            results.push(parsed);
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