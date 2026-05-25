#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd) {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

// 1. Kiểm tra working tree sạch
const status = run("git status --porcelain");
if (status) {
    console.error("❌ Còn file chưa commit:\n" + status);
    console.error("\nHãy commit hoặc stash trước khi release.");
    process.exit(1);
}

// 2. Bump patch version
const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

// 3. Commit + tag + push
run(`git add package.json`);
run(`git commit -m "v${newVersion}"`);
run(`git tag v${newVersion}`);
run(`git push origin main`);
run(`git push origin v${newVersion}`);

console.log(`✅ v${newVersion} đã được push — GitHub Actions đang build...`);
console.log(`   Dùng 'npm run bump' để release lần tới.`);
