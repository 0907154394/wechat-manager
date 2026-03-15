let allAccounts = [];
let filteredAccounts = [];
let selectedExcelFile = null;

window.onload = async () => {
    bindFileDrop();
    await loadAccounts();
    await loadWorkerStatus();
};

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

async function loadAccounts() {
    try {
        const res = await fetch("/api/accounts");
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
        console.error("loadAccounts error:", err);
        alert("Lỗi kết nối server");
    }
}

async function createAccounts() {
    const baseEmail = document.getElementById("baseEmail").value.trim();
    const quantityValue = document.getElementById("quantity").value.trim();
    const password = document.getElementById("password").value.trim();

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
        const res = await fetch("/api/accounts/create-bulk", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                baseEmail,
                quantity,
                password
            })
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Có lỗi khi tạo tài khoản");
            return;
        }

        alert(`Đã tạo ${Array.isArray(data) ? data.length : 0} email biến thể`);

        document.getElementById("baseEmail").value = "";
        document.getElementById("quantity").value = "";
        document.getElementById("password").value = "";

        await loadAccounts();
    } catch (err) {
        console.error("createAccounts error:", err);
        alert("Lỗi kết nối server");
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
                <button class="delete-btn" onclick="deleteAccount('${a._id}')">Xóa</button>
            </td>
        </tr>
        `;
    });

    table.innerHTML = html;
}

function updateStats(data) {
    document.getElementById("total").innerText = data.length;
    document.getElementById("sold").innerText = data.filter(a => a.status === "DA BAN").length;
    document.getElementById("unsold").innerText = data.filter(a => a.status !== "DA BAN").length;
}

function filterAccounts() {
    const keyword = document.getElementById("filterDomain")?.value.trim().toLowerCase() || "";
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
        const res = await fetch("/api/accounts/sell/" + id, { method: "PUT" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không cập nhật được trạng thái");
            return;
        }

        await loadAccounts();
    } catch (err) {
        console.error("sell error:", err);
        alert("Lỗi kết nối server");
    }
}

async function unsell(id) {
    try {
        const res = await fetch("/api/accounts/unsell/" + id, { method: "PUT" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không cập nhật được trạng thái");
            return;
        }

        await loadAccounts();
    } catch (err) {
        console.error("unsell error:", err);
        alert("Lỗi kết nối server");
    }
}

async function updateWechatId(id) {
    const current = allAccounts.find(a => a._id === id);
    const oldWechatId = current?.wechatId || "";
    const wechatId = prompt("Nhập WeChat ID", oldWechatId);

    if (wechatId === null) return;

    try {
        const res = await fetch("/api/accounts/wechat-id/" + id, {
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
        console.error("updateWechatId error:", err);
        alert("Lỗi kết nối server");
    }
}

async function changeLink(id) {
    try {
        const res = await fetch("/api/accounts/change-link/" + id, { method: "PUT" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không đổi được link");
            return;
        }

        await loadAccounts();
    } catch (err) {
        console.error("changeLink error:", err);
        alert("Lỗi kết nối server");
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
        const res = await fetch("/api/accounts/" + id, { method: "DELETE" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Xóa account thất bại");
            return;
        }

        alert(data.message || "Đã xóa account");
        await loadAccounts();
    } catch (err) {
        console.error("deleteAccount error:", err);
        alert("Lỗi kết nối server");
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

async function loadWorkerStatus() {
    try {
        const res = await fetch("/api/worker/status");
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
                Last error: <b>${data.lastError || "-"}</b>
            `;
        } else {
            badge.textContent = "OFFLINE";
            badge.classList.remove("online");
            badge.classList.add("offline");
            info.textContent = "Worker service chưa chạy trên PC.";
        }
    } catch (err) {
        console.error("loadWorkerStatus error:", err);
    }
}

async function startWorker() {
    try {
        const res = await fetch("/api/worker/start", { method: "POST" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không start được worker");
            return;
        }

        await loadWorkerStatus();
        alert("Worker đã start");
    } catch (err) {
        console.error("startWorker error:", err);
        alert("Lỗi kết nối server");
    }
}

async function stopWorker() {
    try {
        const res = await fetch("/api/worker/stop", { method: "POST" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không stop được worker");
            return;
        }

        await loadWorkerStatus();
        alert("Worker đã stop");
    } catch (err) {
        console.error("stopWorker error:", err);
        alert("Lỗi kết nối server");
    }
}

async function reloadWorker() {
    try {
        const res = await fetch("/api/worker/reload", { method: "POST" });
        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Không reload được worker");
            return;
        }

        await loadWorkerStatus();
        alert("Reload accounts thành công");
    } catch (err) {
        console.error("reloadWorker error:", err);
        alert("Lỗi kết nối server");
    }
}

async function importMail() {
    const rows = document.getElementById("importMailRows")?.value.trim() || "";

    if (!rows) {
        alert("Vui lòng nhập dữ liệu mail");
        return;
    }

    try {
        const res = await fetch("/api/accounts/import-mail", {
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
        console.error("importMail error:", err);
        alert("Lỗi kết nối server");
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
        const res = await fetch("/api/accounts/import-mail-file", {
            method: "POST",
            body: formData
        });

        const data = await safeJson(res);

        if (!res.ok) {
            alert(data.message || "Import file thất bại");
            return;
        }

        alert(`Import file thành công. Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped}`);

        selectedExcelFile = null;
        const fileInput = document.getElementById("excelFileInput");
        if (fileInput) fileInput.value = "";
        showSelectedFileName();

        await loadAccounts();
        await loadWorkerStatus();
    } catch (err) {
        console.error("uploadExcelFile error:", err);
        alert("Lỗi kết nối server");
    }
}

async function copyText(text, successMessage = "Đã copy") {
    try {
        await navigator.clipboard.writeText(text);
        alert(successMessage);
    } catch (err) {
        console.error("copyText error:", err);
        alert("Copy thất bại");
    }
}

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