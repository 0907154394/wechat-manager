let allAccounts = [];
let filteredAccounts = [];
let selectedExcelFile = null;

// ─── Auth helpers ────────────────────────────────────────────────────────────

function getAdminToken() {
    return localStorage.getItem("adminToken") || "";
}

function logout() {
    localStorage.removeItem("adminToken");
    window.location.replace("/login.html");
}

// Wrapper around fetch() that always includes the admin token header.
// Automatically redirects to login on 401.
async function adminFetch(url, options = {}) {
    const token = getAdminToken();
    options.headers = Object.assign({}, options.headers, {
        "x-admin-token": token
    });

    const res = await fetch(url, options);

    if (res.status === 401) {
        localStorage.removeItem("adminToken");
        window.location.replace("/login.html");
        throw new Error("Session expired");
    }

    return res;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

window.onload = async () => {
    bindFileDrop();
    await loadAccounts();
    await loadWorkerStatus();
};

// ─── File drop ───────────────────────────────────────────────────────────────

function bindFileDrop() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("excelFileInput");

    if (dropZone) {
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("dragover");
        });

        dropZone.addEventListener("dragleave", () => {
            dropZone.classList.remove("dragover");
        });

        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("dragover");

            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                selectedExcelFile = files[0];
                showSelectedFileName();
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                selectedExcelFile = files[0];
                showSelectedFileName();
            }
        });
    }
}

function showSelectedFileName() {
    const el = document.getElementById("selectedFileName");
    if (!el) return;

    el.textContent = selectedExcelFile
        ? `Đã chọn: ${selectedExcelFile.name}`
        : "";
}

// ─── Accounts ────────────────────────────────────────────────────────────────

async function loadAccounts() {
    try {
        const res = await adminFetch("/api/accounts");
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không tải được dữ liệu");
            return;
        }

        allAccounts = Array.isArray(data) ? data : [];
        filteredAccounts = [...allAccounts];

        renderTable(filteredAccounts);
        updateStats(allAccounts);
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("loadAccounts error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function createAccounts() {
    const baseEmail =
        document.getElementById("baseEmail")?.value.trim() || "";
    const quantityValue =
        document.getElementById("quantity")?.value.trim() || "";
    const password = document.getElementById("password")?.value.trim() || "";
    const gmailAppPassword =
        document.getElementById("gmailAppPassword")?.value.trim() || "";

    const quantity = Number.parseInt(quantityValue, 10);

    if (!baseEmail) {
        alert("Vui lòng nhập email gốc");
        return;
    }

    if (Number.isNaN(quantity) || quantity < 1) {
        alert("Vui lòng nhập số lượng hợp lệ");
        return;
    }

    const createButton = document.querySelector(".create-row button");
    if (createButton) {
        createButton.disabled = true;
        createButton.textContent = "Đang tạo...";
    }

    try {
        const res = await adminFetch("/api/accounts/create-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                baseEmail,
                quantity,
                password,
                gmailAppPassword
            })
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Có lỗi khi tạo tài khoản");
            return;
        }

        const count = Array.isArray(data) ? data.length : 0;
        const imapNote =
            gmailAppPassword && count > 0
                ? ` (IMAP Gmail đã bật cho ${count} variants)`
                : "";
        alert(`Đã tạo ${count} email biến thể${imapNote}`);

        document.getElementById("baseEmail").value = "";
        document.getElementById("quantity").value = "";
        document.getElementById("password").value = "";
        document.getElementById("gmailAppPassword").value = "";

        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("createAccounts error:", err);
            alert("Lỗi kết nối server");
        }
    } finally {
        if (createButton) {
            createButton.disabled = false;
            createButton.textContent = "Tạo biến thể";
        }
    }
}

function renderTable(data) {
    const table = document.getElementById("table");

    if (!table) return;

    if (!data.length) {
        table.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">Không có dữ liệu</td>
            </tr>
        `;
        return;
    }

    let html = "";

    data.forEach((a, i) => {
        const statusClass = a.status === "DA BAN" ? "da" : "chua";
        const fullLink = a.linkToken ? window.location.origin + a.linkToken : "";

        html += `
        <tr>
            <td>${i + 1}</td>

            <td>
                <div class="token-stack">
                    <span class="copy-text">${escapeHtml(a.email || "")}</span>
                    <div class="inline-actions">
                        <button class="copy-btn small-btn" onclick="copyText('${escapeJs(a.email || "")}', 'Đã copy email')">Copy Email</button>
                    </div>
                </div>
            </td>

            <td>
                <div class="token-stack">
                    <span>${escapeHtml(a.password || "")}</span>
                    <div class="inline-actions">
                        <button class="copy-btn small-btn" onclick="copyText('${escapeJs(a.password || "")}', 'Đã copy password')">Copy PW</button>
                    </div>
                </div>
            </td>

            <td>
                <span class="status ${statusClass}">
                    ${escapeHtml(a.status || "")}
                </span>
            </td>

            <td>${escapeHtml(a.wechatId || "-")}</td>

            <td>
                ${
                    a.linkToken
                        ? `
                        <div class="token-stack">
                            <a class="token-link" href="${fullLink}" target="_blank">${escapeHtml(a.linkToken)}</a>
                            <div class="inline-actions">
                                <button class="copy-btn small-btn" onclick="copyText('${escapeJs(fullLink)}', 'Đã copy link token')">Copy Link</button>
                                <button class="link-btn small-btn" onclick="openLinkToken('${escapeJs(fullLink)}')">Mở link</button>
                            </div>
                        </div>
                    `
                        : "-"
                }
            </td>

            <td>${escapeHtml(a.messageToken || "-")}</td>

            <td class="action-group">
                <button class="wechat-btn" onclick="updateWechatId('${a._id}')">WeChat ID</button>

                ${
                    a.status === "DA BAN"
                        ? `<button class="unsell-btn" onclick="unsell('${a._id}')">Hủy bán</button>`
                        : `<button class="sell-btn" onclick="sell('${a._id}')">Bán</button>`
                }

                <button class="link-btn" onclick="changeLink('${a._id}')">Đổi link</button>
                <button class="link-btn" onclick="viewMessages('${a.messageToken || ""}')">Tin nhắn</button>
                <button class="link-btn" onclick="editImap('${a._id}', '${escapeJs(a.imapUser||a.email||"")}', '${escapeJs(a.imapHost||"")}')">IMAP</button>
                <button class="delete-btn" onclick="deleteAccount('${a._id}')">Xóa</button>
            </td>
        </tr>
        `;
    });

    table.innerHTML = html;
}

function updateStats(data) {
    const totalEl = document.getElementById("total");
    const soldEl = document.getElementById("sold");
    const unsoldEl = document.getElementById("unsold");

    if (totalEl) totalEl.innerText = data.length;
    if (soldEl) soldEl.innerText = data.filter(a => a.status === "DA BAN").length;
    if (unsoldEl) unsoldEl.innerText = data.filter(a => a.status !== "DA BAN").length;
}

function filterAccounts() {
    const keyword =
        document.getElementById("filterDomain")?.value.trim().toLowerCase() || "";
    const status = document.getElementById("filterStatus")?.value || "";

    filteredAccounts = allAccounts.filter(account => {
        const email = String(account.email || "").toLowerCase();
        const wechatId = String(account.wechatId || "").toLowerCase();
        const linkToken = String(account.linkToken || "").toLowerCase();
        const messageToken = String(account.messageToken || "").toLowerCase();

        const matchKeyword =
            !keyword ||
            email.includes(keyword) ||
            wechatId.includes(keyword) ||
            linkToken.includes(keyword) ||
            messageToken.includes(keyword);

        const matchStatus = !status || account.status === status;

        return matchKeyword && matchStatus;
    });

    renderTable(filteredAccounts);
}

async function sell(id) {
    try {
        const res = await adminFetch("/api/accounts/sell/" + id, {
            method: "PUT"
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không cập nhật được trạng thái");
            return;
        }

        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("sell error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function unsell(id) {
    try {
        const res = await adminFetch("/api/accounts/unsell/" + id, {
            method: "PUT"
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không cập nhật được trạng thái");
            return;
        }

        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("unsell error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function updateWechatId(id) {
    const current = allAccounts.find(a => a._id === id);
    const oldWechatId = current?.wechatId || "";
    const wechatId = prompt("Nhập WeChat ID", oldWechatId);

    if (wechatId === null) return;

    try {
        const res = await adminFetch("/api/accounts/wechat-id/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wechatId: wechatId.trim() })
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không cập nhật được WeChat ID");
            return;
        }

        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("updateWechatId error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function changeLink(id) {
    try {
        const res = await adminFetch("/api/accounts/change-link/" + id, {
            method: "PUT"
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không đổi được link");
            return;
        }

        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("changeLink error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

function viewMessages(token) {
    if (!token) {
        alert("Account chưa có token tin nhắn");
        return;
    }

    window.open("/messages.html?token=" + encodeURIComponent(token), "_blank");
}

function openLinkToken(fullLink) {
    if (!fullLink) {
        alert("Không có link token");
        return;
    }

    window.open(fullLink, "_blank");
}

async function deleteAccount(id) {
    const ok = confirm("Bạn có chắc muốn xóa account này không?");
    if (!ok) return;

    try {
        const res = await adminFetch("/api/accounts/" + id, {
            method: "DELETE"
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Xóa account thất bại");
            return;
        }

        alert(data.message || "Đã xóa account");
        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("deleteAccount error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

function exportAccounts() {
    if (!filteredAccounts.length) {
        alert("Không có dữ liệu để export");
        return;
    }

    let content = "Email,Password,TrangThai,WeChatID,LinkToken,MessageToken\n";

    filteredAccounts.forEach(a => {
        content += `"${csvSafe(a.email)}","${csvSafe(a.password)}","${csvSafe(a.status)}","${csvSafe(a.wechatId)}","${csvSafe(a.linkToken)}","${csvSafe(a.messageToken)}"\n`;
    });

    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "accounts.csv";
    link.click();
    URL.revokeObjectURL(url);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function loadWorkerStatus() {
    try {
        const res = await adminFetch("/api/worker/status");
        const data = await safeJson(res);

        const badge = document.getElementById("workerStatusBadge");
        const info = document.getElementById("workerInfo");

        if (!badge || !info) return;

        if (res.ok && data.running) {
            badge.textContent = "ONLINE";
            badge.classList.remove("offline");
            badge.classList.add("online");

            info.innerHTML = `
                Worker đang chạy.<br>
                Active accounts: <b>${data.activeAccounts || 0}</b><br>
                Last run: <b>${data.lastRunAt || "-"}</b><br>
                Last error: <b>${escapeHtml(data.lastError || "-")}</b>
            `;
        } else {
            badge.textContent = "OFFLINE";
            badge.classList.remove("online");
            badge.classList.add("offline");
            info.textContent = "Worker service chưa chạy.";
        }
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("loadWorkerStatus error:", err);
        }
    }
}

async function startWorker() {
    try {
        const res = await adminFetch("/api/worker/start", { method: "POST" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không start được worker");
            return;
        }

        await loadWorkerStatus();
        alert("Worker đã start");
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("startWorker error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function stopWorker() {
    try {
        const res = await adminFetch("/api/worker/stop", { method: "POST" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không stop được worker");
            return;
        }

        await loadWorkerStatus();
        alert("Worker đã stop");
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("stopWorker error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function reloadWorker() {
    try {
        const res = await adminFetch("/api/worker/reload", { method: "POST" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không reload được worker");
            return;
        }

        await loadWorkerStatus();
        alert("Reload accounts thành công");
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("reloadWorker error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function importMail() {
    const rows = document.getElementById("importMailRows")?.value.trim() || "";

    if (!rows) {
        alert("Vui lòng nhập dữ liệu mail");
        return;
    }

    try {
        const res = await adminFetch("/api/accounts/import-mail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows })
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Import mail thất bại");
            return;
        }

        alert(`Import thành công. Created: ${data.created}, Updated: ${data.updated}`);

        const importArea = document.getElementById("importMailRows");
        if (importArea) importArea.value = "";

        await loadAccounts();
        await loadWorkerStatus();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("importMail error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

async function uploadExcelFile() {
    if (!selectedExcelFile) {
        alert("Vui lòng chọn hoặc kéo file CSV vào trước");
        return;
    }

    const formData = new FormData();
    formData.append("file", selectedExcelFile);

    try {
        const res = await adminFetch("/api/accounts/import-mail-file", {
            method: "POST",
            body: formData
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Import file thất bại");
            return;
        }

        alert(
            `Import file thành công. Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped}`
        );

        selectedExcelFile = null;
        const fileInput = document.getElementById("excelFileInput");
        if (fileInput) fileInput.value = "";
        showSelectedFileName();

        await loadAccounts();
        await loadWorkerStatus();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("uploadExcelFile error:", err);
            alert("Lỗi kết nối server");
        }
    }
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

async function copyText(text, successMessage = "Đã copy") {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            alert(successMessage);
            return;
        }

        fallbackCopyText(text, successMessage);
    } catch (err) {
        console.error("copyText error:", err);
        fallbackCopyText(text, successMessage);
    }
}

function fallbackCopyText(text, successMessage = "Đã copy") {
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        textArea.setAttribute("readonly", "");
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, textArea.value.length);

        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (successful) {
            alert(successMessage);
        } else {
            alert("Copy thất bại");
        }
    } catch (err) {
        console.error("fallbackCopyText error:", err);
        alert("Copy thất bại");
    }
}

// ─── IMAP Modal ──────────────────────────────────────────────────────────────

let _imapTargetId = "";

function editImap(id, currentUser, currentHost) {
    _imapTargetId = id;

    const modal = document.getElementById("imapModal");
    document.getElementById("mi_host").value = currentHost || "imap.gmail.com";
    document.getElementById("mi_user").value = currentUser || "";
    document.getElementById("mi_pass").value = "";

    modal.style.display = "flex";
    setTimeout(() => document.getElementById("mi_pass").focus(), 80);
}

function closeImapModal() {
    document.getElementById("imapModal").style.display = "none";
    _imapTargetId = "";
}

async function saveImap() {
    const host = document.getElementById("mi_host").value.trim();
    const user = document.getElementById("mi_user").value.trim();
    const pass = document.getElementById("mi_pass").value.trim();

    if (!host || !user || !pass) {
        document.getElementById("mi_pass").style.borderColor = "#ef4444";
        return;
    }

    const btn = document.getElementById("imapSaveBtn");
    btn.disabled = true;
    btn.textContent = "Đang lưu...";

    try {
        const res = await adminFetch("/api/accounts/update-imap/" + _imapTargetId, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imapHost: host, imapUser: user, imapPass: pass, imapPort: 993, imapSecure: true })
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Cập nhật IMAP thất bại");
            return;
        }

        closeImapModal();
        await loadAccounts();
    } catch (err) {
        if (err.message !== "Session expired") {
            console.error("saveImap error:", err);
            alert("Lỗi kết nối server");
        }
    } finally {
        btn.disabled = false;
        btn.textContent = "Lưu";
    }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

async function safeJson(res) {
    const text = await res.text();

    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { message: text || "Phản hồi không hợp lệ từ server" };
    }
}

function csvSafe(value) {
    return String(value || "");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeJs(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r");
}
