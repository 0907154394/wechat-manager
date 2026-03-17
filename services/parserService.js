function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function extractCode(text) {
    const input = cleanText(text);
    if (!input) return "";

    const candidates = input.match(/\b\d{4,8}\b/g) || [];
    return candidates.length ? candidates[0] : "";
}

function buildMessagePayload(parsedMail) {
    const sender =
        cleanText(parsedMail.from?.text) ||
        cleanText(parsedMail.from?.value?.[0]?.address) ||
        "Unknown";

    const subject = cleanText(parsedMail.subject || "");
    const content = cleanText(parsedMail.text || parsedMail.html || "");
    const code = extractCode(`${subject} ${content}`);

    return {
        sender,
        subject,
        content,
        code
    };
}

module.exports = {
    cleanText,
    extractCode,
    buildMessagePayload
};