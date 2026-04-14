/**
 * afterPack hook — injects GH_TOKEN into app-update.yml so electron-updater
 * can authenticate with the private GitHub repo to check and download updates.
 */
const fs   = require("fs");
const path = require("path");

exports.default = async (context) => {
    const token = process.env.GH_TOKEN;
    if (!token) {
        console.warn("[afterPack] GH_TOKEN không có — auto-update sẽ không hoạt động với private repo");
        return;
    }

    const ymlPath = path.join(context.appOutDir, "resources", "app-update.yml");
    if (!fs.existsSync(ymlPath)) {
        console.warn("[afterPack] Không tìm thấy app-update.yml tại", ymlPath);
        return;
    }

    let content = fs.readFileSync(ymlPath, "utf8");

    // Xoá dòng token cũ nếu có, rồi thêm mới
    content = content.replace(/^token:.*$/m, "").trim();
    content += `\ntoken: '${token}'\n`;

    fs.writeFileSync(ymlPath, content, "utf8");
    console.log("[afterPack] Đã inject token vào app-update.yml");
};
