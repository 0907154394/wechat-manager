function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function extractCode(text) {
    const input = cleanText(text);

    if (!input) return "";

    const keywordRegex =
        /(code|otp|verification|verify|security|login|wechat|telegram|discord|facebook|google)/i;

    const candidates = input.match(/\b\d{4,8}\b/g) || [];

    if (!candidates.length) return "";

    if (keywordRegex.test(input)) {
        return candidates[0];
    }

    return candidates[0];
}

function buildMessagePayload(mail) {
    const sender =
        cleanText(mail.from?.name) ||
        cleanText(mail.from?.address) ||
        "Unknown";

    const subject = cleanText(mail.subject || "");
    const content = cleanText(mail.text || mail.html || "");
    const code = extractCode(`${subject} ${content}`);

    return {
        sender,
        subject,
        content,
        code
    };
}

module.exports = {
    extractCode,
    buildMessagePayload
};