/**
 * Publishes the latest draft GitHub release for this version.
 * Run after electron-builder to make the release visible to auto-updater.
 */
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const pkg   = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
const token = process.env.GH_TOKEN;
const owner = pkg.build.publish.owner;
const repo  = pkg.build.publish.repo;
const tag   = `v${pkg.version}`;

if (!token) {
    console.log("[publish] GH_TOKEN không có, bỏ qua.");
    process.exit(0);
}

function api(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: "api.github.com",
            path:     `/repos/${owner}/${repo}${endpoint}`,
            method,
            headers: {
                "Authorization":  `token ${token}`,
                "User-Agent":     "wechat-manager-publish-script",
                "Accept":         "application/vnd.github.v3+json",
                "Content-Type":   "application/json",
                ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
            }
        }, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function getRelease(retries = 8, delayMs = 3000) {
    for (let i = 0; i < retries; i++) {
        if (i > 0) {
            console.log(`[publish] Thử lại sau ${delayMs / 1000}s... (${i}/${retries})`);
            await new Promise(r => setTimeout(r, delayMs));
        }
        // List all releases (includes drafts) — /releases/tags/{tag} bỏ qua draft
        const { status, body } = await api("GET", "/releases?per_page=10");
        if (status === 200 && Array.isArray(body)) {
            const found = body.find(r => r.tag_name === tag);
            if (found) return found;
        }
    }
    return null;
}

async function main() {
    console.log(`[publish] Tìm release ${tag}...`);

    const release = await getRelease();

    if (!release) {
        console.error(`[publish] Không tìm thấy release ${tag} sau nhiều lần thử`);
        process.exit(1);
    }

    if (!release.draft) {
        console.log(`[publish] Release ${tag} đã published rồi.`);
        return;
    }

    const { status: patchStatus } = await api("PATCH", `/releases/${release.id}`, { draft: false });

    if (patchStatus === 200) {
        console.log(`[publish] Release ${tag} published thành công.`);
    } else {
        console.error(`[publish] Lỗi khi publish: HTTP ${patchStatus}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error("[publish] Lỗi:", err.message);
    process.exit(1);
});
