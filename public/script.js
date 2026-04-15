let allAccounts = [];
let filteredAccounts = [];
let selectedIds = new Set();
let currentPage = 1;
let PAGE_SIZE = 50;
let selectedExcelFile = null;
let publicBaseUrl = "";   // Cloudflare tunnel URL (changes on restart)
let workerBaseUrl = "";   // Cloudflare Worker URL (stable)
let imapAccountErrors = {}; // imapUser → error message

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getAdminToken() { return localStorage.getItem("adminToken") || ""; }

function logout() {
    localStorage.removeItem("adminToken");
    window.location.replace("/login.html");
}

async function adminFetch(url, options = {}) {
    options.headers = Object.assign({}, options.headers, {
        "x-admin-token": getAdminToken()
    });
    const res = await fetch(url, options);
    if (res.status === 401) {
        localStorage.removeItem("adminToken");
        window.location.replace("/login.html");
        throw new Error("Session expired");
    }
    return res;
}

// ─── Section navigation ───────────────────────────────────────────────────────

function showSection(name) {
    ["accounts", "tools", "settings"].forEach(s => {
        const el = document.getElementById("section-" + s);
        const btn = document.getElementById("nav-" + s);
        if (s === name) {
            el.style.display = "";
            el.classList.remove("section-enter");
            void el.offsetWidth; // reflow
            el.classList.add("section-enter");
        } else {
            el.style.display = "none";
        }
        if (btn) btn.classList.toggle("active", s === name);
    });
    if (name === "settings") loadSettingsSection();
}

async function loadSettingsSection() {
    try {
        const res = await adminFetch("/api/settings/info");
        const data = await safeJson(res);
        const u = document.getElementById("st_currentUser");
        const n = document.getElementById("st_newUser");
        if (u) u.value = data.username || "";
        if (n && !n.value) n.value = data.username || "";
        // Load Worker URL
        if (data.workerUrl) workerBaseUrl = data.workerUrl.replace(/\/$/, "");
        const wu = document.getElementById("st_workerUrl");
        if (wu && data.workerUrl) wu.value = data.workerUrl;
        const ws = document.getElementById("st_workerSecret");
        if (ws && data.hasSecret) ws.placeholder = "Secret đã lưu — để trống để giữ nguyên";
    } catch { /* ignore */ }
    renderImapHealth();
}

function renderImapHealth() {
    const el = document.getElementById("imapHealthList");
    if (!el) return;
    const errors = Object.entries(imapAccountErrors).filter(([, v]) => v);
    if (!errors.length) {
        el.innerHTML = '<span class="health-ok">Tất cả IMAP hoạt động bình thường.</span>';
        return;
    }
    el.innerHTML = errors.map(([user, msg]) => `
        <div class="health-error-item">
            <span class="health-user">${escapeHtml(user)}</span>
            <span class="health-msg">${escapeHtml(msg)}</span>
        </div>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────

window.onload = async () => {
    bindFileDrop();
    await loadConfig();
    await loadAccounts();
    await loadWorkerStatus();

    // Tự động làm mới danh sách mỗi 60 giây:
    // - Cập nhật bộ đếm "còn X phút" trên UI
    // - Tạo link mới thay thế link đã hết hạn (server tự gia hạn)
    setInterval(async () => {
        await loadAccounts();
    }, 60 * 1000);
};

async function loadConfig() {
    try {
        const res = await fetch("/api/config");
        const data = await res.json();
        if (data.publicUrl) publicBaseUrl = data.publicUrl;
    } catch { /* dùng window.location.origin làm fallback */ }
    // Load Worker URL from settings (to build customer links)
    try {
        const res = await adminFetch("/api/settings/info");
        const data = await safeJson(res);
        if (data.workerUrl) workerBaseUrl = data.workerUrl.replace(/\/$/, "");
    } catch { /* ignore */ }
}

// ─── File drop ───────────────────────────────────────────────────────────────

function bindFileDrop() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("excelFileInput");

    if (dropZone) {
        dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
        dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
        dropZone.addEventListener("drop", e => {
            e.preventDefault(); dropZone.classList.remove("dragover");
            if (e.dataTransfer.files[0]) { selectedExcelFile = e.dataTransfer.files[0]; showSelectedFileName(); }
        });
    }
    if (fileInput) {
        fileInput.addEventListener("change", e => {
            if (e.target.files[0]) { selectedExcelFile = e.target.files[0]; showSelectedFileName(); }
        });
    }
}

function showSelectedFileName() {
    const el = document.getElementById("selectedFileName");
    if (el) el.textContent = selectedExcelFile ? `Đã chọn: ${selectedExcelFile.name}` : "";
}

// ─── Accounts ────────────────────────────────────────────────────────────────

let isArchivedView = false;

async function loadAccounts() {
    try {
        const url = isArchivedView ? "/api/accounts?archived=true" : "/api/accounts";
        const res = await adminFetch(url);
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Không tải được dữ liệu"); return; }
        allAccounts = Array.isArray(data) ? data : [];
        filteredAccounts = [...allAccounts];
        currentPage = 1;
        renderTable(filteredAccounts);
        updateStats(allAccounts);
    } catch (err) {
        if (err.message !== "Session expired") { console.error(err); alert("Lỗi kết nối server"); }
    }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dateAddedHtml(createdAt) {
    if (!createdAt) return `<span style="color:var(--text-muted)">-</span>`;
    const d = new Date(createdAt);
    const day   = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year  = d.getFullYear();
    return `<span class="date-added">${day}/${month}/${year}</span>`;
}

// ─── Countdown helpers ────────────────────────────────────────────────────────

function linkMinLeft(expiresAt) {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

function calcDaysLeft(wechatCreatedAt) {
    if (!wechatCreatedAt) return null;
    const deadline = new Date(new Date(wechatCreatedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
    return Math.ceil((deadline - Date.now()) / 86400000);
}

function countdownHtml(wechatCreatedAt) {
    const d = calcDaysLeft(wechatCreatedAt);
    if (d === null) return `<span class="countdown none">-</span>`;
    if (d > 4)  return `<span class="countdown ok">${d} ngày</span>`;
    if (d > 1)  return `<span class="countdown warn">${d} ngày</span>`;
    if (d >= 0) return `<span class="countdown danger">${d === 0 ? "Hôm nay" : d + " ngày"}</span>`;
    return `<span class="countdown expired">Hết hạn</span>`;
}

// ─── Render table ─────────────────────────────────────────────────────────────

function renderTable(data) {
    const tbody = document.getElementById("table");
    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Không có dữ liệu</td></tr>`;
        renderPagination(0);
        return;
    }

    const totalPages = Math.ceil(data.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = data.slice(start, start + PAGE_SIZE);

    let html = "";
    pageData.forEach((a, i) => {
        const globalIdx = start + i;
        const statusClass = a.status === "DA BAN" ? "da" : "chua";
        const linkBase = workerBaseUrl || publicBaseUrl || window.location.origin;
        const fullLink = a.linkToken ? linkBase + a.linkToken : "";
        const checked = selectedIds.has(a._id) ? "checked" : "";
        const imapUser = escapeJs(a.imapUser || a.email || "");
        const imapHost = escapeJs(a.imapHost || "");
        const hasImapErr = !!(imapAccountErrors[a.imapUser] || imapAccountErrors[a.email]);
        const errTitle = hasImapErr ? escapeHtml(imapAccountErrors[a.imapUser] || imapAccountErrors[a.email] || "IMAP lỗi") : "";

        html += `
        <tr>
            <td><input type="checkbox" ${checked} onchange="toggleSelect('${a._id}', this.checked)"></td>
            <td>${globalIdx + 1}</td>

            <td>
                <div class="token-stack">
                    <div style="display:flex;align-items:center;justify-content:center;gap:4px">
                        <span class="copy-text">${escapeHtml(a.email || "")}</span>
                        ${hasImapErr ? `<span class="imap-err-dot" title="${errTitle}">!</span>` : ""}
                    </div>
                    <div class="inline-actions">
                        <button class="copy-btn small-btn" onclick="copyText('${escapeJs(a.email || "")}')">Copy</button>
                    </div>
                </div>
            </td>

            <td>
                <div style="font-size:12.5px;color:#dde6f5">${escapeHtml(a.wechatId || "-")}</div>
            </td>

            <td><span class="status ${statusClass}">${a.status === "DA BAN" ? "Đã bán" : "Chưa bán"}</span></td>

            <td>
                ${dateAddedHtml(a.wechatCreatedAt)}
            </td>

            <td>
                ${fullLink ? `
                <div class="token-stack">
                    <a class="token-link" href="${fullLink}" target="_blank" style="font-size:11.5px">${escapeHtml(a.linkToken)}</a>
                    <div style="font-size:11px;color:${linkMinLeft(a.linkTokenExpiresAt) <= 3 ? '#fb923c' : '#64748b'};margin:1px 0">
                        ${linkMinLeft(a.linkTokenExpiresAt) > 0 ? '⏱ còn ' + linkMinLeft(a.linkTokenExpiresAt) + ' phút' : '🔄 đang làm mới...'}
                    </div>
                    <button class="copy-btn small-btn" onclick="copyText('${escapeJs(fullLink)}')">Copy link</button>
                </div>` : "-"}
            </td>

            <td class="action-group">
                ${isArchivedView ? `
                <button class="sell-btn" onclick="restoreAccount('${a._id}')">Khôi phục</button>
                <button class="delete-btn" onclick="hardDeleteAccount('${a._id}')">Xóa cứng</button>
                ` : `
                ${a.status === "DA BAN"
                    ? `<button class="unsell-btn" onclick="unsell('${a._id}')">Hủy bán</button>`
                    : `<button class="sell-btn" onclick="sell('${a._id}')">Bán</button>`}
                <button class="wechat-btn" onclick="updateWechatId('${a._id}')">WeChat ID</button>
                <button class="link-btn" onclick="viewMessages('${a.messageToken || ""}')">OTP</button>
                <button class="link-btn" onclick="editImap('${a._id}', '${imapUser}', '${imapHost}')">IMAP</button>
                <button class="delete-btn" onclick="deleteAccount('${a._id}')">Lưu trữ</button>
                `}
            </td>
        </tr>`;
    });

    tbody.innerHTML = html;
    updateBulkBar();
    renderPagination(data.length);
}

function renderPagination(total) {
    const el = document.getElementById("pagination");
    if (!el) return;

    if (total === 0) { el.innerHTML = ""; return; }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);

    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (currentPage > 3) pages.push("...");
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push("...");
        pages.push(totalPages);
    }

    const prevDis = currentPage === 1 ? "disabled" : "";
    const nextDis = currentPage === totalPages ? "disabled" : "";

    let html = `
    <div class="page-left">
        <span class="page-info">${start}–${end} / <b>${total}</b> tài khoản</span>
        <select class="page-size-select" onchange="changePageSize(this.value)">
            <option value="25"  ${PAGE_SIZE===25  ? "selected":""}>25 / trang</option>
            <option value="50"  ${PAGE_SIZE===50  ? "selected":""}>50 / trang</option>
            <option value="100" ${PAGE_SIZE===100 ? "selected":""}>100 / trang</option>
            <option value="200" ${PAGE_SIZE===200 ? "selected":""}>200 / trang</option>
        </select>
    </div>
    <div class="page-btns">
        <button class="page-btn" onclick="goToPage(${currentPage - 1})" ${prevDis}>&#8592;</button>`;
    pages.forEach(p => {
        if (p === "...") html += `<span class="page-ellipsis">…</span>`;
        else html += `<button class="page-btn${p === currentPage ? " active" : ""}" onclick="goToPage(${p})">${p}</button>`;
    });
    html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})" ${nextDis}>&#8594;</button>`;
    if (totalPages > 5) {
        html += `<input type="number" class="page-jump" min="1" max="${totalPages}" placeholder="Trang..." onkeydown="if(event.key==='Enter') goToPage(+this.value)">`;
    }
    html += `</div>`;

    el.innerHTML = html;
}

function changePageSize(size) {
    PAGE_SIZE = parseInt(size);
    currentPage = 1;
    renderTable(filteredAccounts);
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredAccounts.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderTable(filteredAccounts);
    document.querySelector(".table-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateStats(data) {
    document.getElementById("total").innerText   = data.length;
    document.getElementById("sold").innerText    = data.filter(a => a.status === "DA BAN").length;
    document.getElementById("unsold").innerText  = data.filter(a => a.status !== "DA BAN").length;
    const expiring = data.filter(a => { const d = calcDaysLeft(a.wechatCreatedAt); return d !== null && d <= 3 && d >= 0; });
    document.getElementById("expiring").innerText = expiring.length;
}

// ─── Filter ───────────────────────────────────────────────────────────────────

async function filterAccounts() {
    const keyword = (document.getElementById("filterDomain")?.value || "").trim().toLowerCase();
    const status  = document.getElementById("filterStatus")?.value || "";

    // Chuyển sang archived view nếu chọn filter "ARCHIVED"
    const wantArchived = status === "ARCHIVED";
    if (wantArchived !== isArchivedView) {
        isArchivedView = wantArchived;
        // Cập nhật bulk bar buttons
        const norm = document.getElementById("bulkActionsNormal");
        const arch = document.getElementById("bulkActionsArchived");
        if (norm) norm.style.display = isArchivedView ? "none" : "";
        if (arch) arch.style.display = isArchivedView ? "" : "none";
        selectedIds.clear();
        await loadAccounts();
        return;
    }

    currentPage = 1;
    filteredAccounts = allAccounts.filter(a => {
        const matchKeyword = !keyword ||
            (a.email || "").toLowerCase().includes(keyword) ||
            (a.wechatId || "").toLowerCase().includes(keyword) ||
            (a.linkToken || "").toLowerCase().includes(keyword);

        let matchStatus = true;
        if (status === "EXPIRING") {
            const d = calcDaysLeft(a.wechatCreatedAt);
            matchStatus = d !== null && d <= 3 && d >= 0;
        } else if (status && status !== "ARCHIVED") {
            matchStatus = a.status === status;
        }

        return matchKeyword && matchStatus;
    });

    renderTable(filteredAccounts);
}

// ─── Checkbox / Bulk ─────────────────────────────────────────────────────────

function toggleSelect(id, checked) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateBulkBar();
}

function toggleSelectAll(cb) {
    filteredAccounts.forEach(a => {
        if (cb.checked) selectedIds.add(a._id);
        else selectedIds.delete(a._id);
    });
    renderTable(filteredAccounts);
}

function clearSelection() {
    selectedIds.clear();
    renderTable(filteredAccounts);
}

function updateBulkBar() {
    const bar = document.getElementById("bulkBar");
    const countEl = document.getElementById("bulkCount");
    if (!bar) return;
    if (selectedIds.size > 0) {
        bar.style.display = "flex";
        countEl.textContent = `${selectedIds.size} tài khoản đã chọn`;
    } else {
        bar.style.display = "none";
    }
}

async function bulkSell() {
    if (!selectedIds.size) return;
    const ok = confirm(`Bán ${selectedIds.size} tài khoản?`);
    if (!ok) return;
    try {
        const res = await adminFetch("/api/accounts/bulk-sell", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...selectedIds] })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }
        selectedIds.clear();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function bulkDelete() {
    if (!selectedIds.size) return;
    const ok = confirm(`Lưu trữ ${selectedIds.size} tài khoản? (có thể khôi phục sau)`);
    if (!ok) return;
    try {
        const res = await adminFetch("/api/accounts/bulk", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...selectedIds] })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }
        selectedIds.clear();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function bulkRestore() {
    if (!selectedIds.size) return;
    const ok = confirm(`Khôi phục ${selectedIds.size} tài khoản?`);
    if (!ok) return;
    try {
        const res = await adminFetch("/api/accounts/restore-bulk", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...selectedIds] })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }
        selectedIds.clear();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function bulkHardDelete() {
    if (!selectedIds.size) return;
    const ok = confirm(`Xóa cứng ${selectedIds.size} tài khoản? Không thể hoàn tác!`);
    if (!ok) return;
    try {
        const res = await adminFetch("/api/accounts/hard-bulk", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...selectedIds] })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }
        selectedIds.clear();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

// ─── Account actions ──────────────────────────────────────────────────────────

async function sell(id) {
    try {
        const res = await adminFetch("/api/accounts/sell/" + id, { method: "PUT" });
        if ((await safeJson(res)).message || res.ok) await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function unsell(id) {
    try {
        const res = await adminFetch("/api/accounts/unsell/" + id, { method: "PUT" });
        if (res.ok) await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

let _wechatIdTarget = "";

function updateWechatId(id) {
    _wechatIdTarget = id;
    const current = allAccounts.find(a => a._id === id);
    document.getElementById("wi_value").value = current?.wechatId || "";
    document.getElementById("wechatIdModal").style.display = "flex";
    setTimeout(() => document.getElementById("wi_value").focus(), 80);
}

function closeWechatIdModal() {
    document.getElementById("wechatIdModal").style.display = "none";
    _wechatIdTarget = "";
}

async function saveWechatId() {
    const id = _wechatIdTarget;
    const wechatId = document.getElementById("wi_value").value.trim();
    const btn = document.getElementById("wi_saveBtn");
    const current = allAccounts.find(a => a._id === id);

    btn.disabled = true; btn.textContent = "Đang lưu...";
    try {
        const res = await adminFetch("/api/accounts/wechat-id/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wechatId })
        });
        if (!res.ok) { alert((await safeJson(res)).message); return; }

        // Nếu chưa có ngày đăng ký WeChat, tự set hôm nay
        if (wechatId.trim() && !current?.wechatCreatedAt) {
            await adminFetch("/api/accounts/wechat-date/" + id, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wechatCreatedAt: new Date().toISOString() })
            });
        }

        closeWechatIdModal();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
    finally { btn.disabled = false; btn.textContent = "Lưu"; }
}


function viewMessages(token) {
    if (!token) { alert("Account chưa có token"); return; }
    window.open("/messages.html?token=" + encodeURIComponent(token), "_blank");
}

async function deleteAccount(id) {
    if (!confirm("Lưu trữ account này? (có thể khôi phục sau)")) return;
    try {
        const res = await adminFetch("/api/accounts/" + id, { method: "DELETE" });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message); return; }
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function restoreAccount(id) {
    try {
        const res = await adminFetch("/api/accounts/restore/" + id, { method: "PUT" });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message); return; }
        showToast("Đã khôi phục");
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function hardDeleteAccount(id) {
    if (!confirm("Xóa cứng? Không thể hoàn tác, email variant này có thể bị tái sử dụng!")) return;
    try {
        const res = await adminFetch("/api/accounts/hard/" + id, { method: "DELETE" });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message); return; }
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

// ─── Create / Import ─────────────────────────────────────────────────────────

async function createAccounts() {
    const baseEmail        = document.getElementById("baseEmail")?.value.trim() || "";
    const quantity         = parseInt(document.getElementById("quantity")?.value || "0", 10);
    const gmailAppPassword = document.getElementById("gmailAppPassword")?.value.trim() || "";

    if (!baseEmail) { alert("Vui lòng nhập email gốc"); return; }
    if (!quantity || quantity < 1) { alert("Vui lòng nhập số lượng"); return; }

    const btn = document.querySelector(".create-row button");
    if (btn) { btn.disabled = true; btn.textContent = "Đang tạo..."; }

    try {
        const res = await adminFetch("/api/accounts/create-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseEmail, quantity, gmailAppPassword })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }

        const count = Array.isArray(data) ? data.length : 0;
        const imapCount = Array.isArray(data) ? data.filter(a => a.imapEnabled).length : 0;
        let msg = `Đã tạo ${count} variants`;
        if (gmailAppPassword)       msg += " — IMAP đã bật";
        else if (imapCount > 0)     msg += " — IMAP kế thừa từ Gmail này";
        else                        msg += " — chưa có IMAP (nhập App Password để bật)";
        alert(msg);
        ["baseEmail","quantity","gmailAppPassword"].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = "";
        });
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Tạo biến thể"; } }
}

async function importMail() {
    const rows = document.getElementById("importMailRows")?.value.trim() || "";
    if (!rows) { alert("Vui lòng nhập dữ liệu"); return; }
    try {
        const res = await adminFetch("/api/accounts/import-mail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message); return; }
        alert(`Import thành công — Tạo mới: ${data.created}, Cập nhật: ${data.updated}`);
        document.getElementById("importMailRows").value = "";
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function uploadExcelFile() {
    if (!selectedExcelFile) { alert("Chưa chọn file"); return; }
    const formData = new FormData();
    formData.append("file", selectedExcelFile);
    try {
        const res = await adminFetch("/api/accounts/import-mail-file", { method: "POST", body: formData });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message); return; }
        alert(`Import CSV — Tạo: ${data.created}, Cập nhật: ${data.updated}, Bỏ qua: ${data.skipped}`);
        selectedExcelFile = null;
        const fi = document.getElementById("excelFileInput"); if (fi) fi.value = "";
        showSelectedFileName();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

// ─── Smart Import ────────────────────────────────────────────────────────────

let _smartImportRows = [];

function detectDelimiter(text) {
    const line = (text.split("\n")[0] || "").slice(0, 500);
    const scores = {
        "|": (line.match(/\|/g) || []).length,
        ",": (line.match(/,/g)  || []).length,
        "\t":(line.match(/\t/g) || []).length,
        ":": (line.match(/:/g)  || []).length,
    };
    let best = "|", bestCount = 0;
    for (const [d, cnt] of Object.entries(scores)) {
        if (cnt > bestCount) { bestCount = cnt; best = d; }
    }
    return bestCount > 0 ? best : " ";
}

function parseSmartImport(text) {
    const FIELDS = ["email","password","imapHost","imapPort","imapUser","imapPass","secure"];
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const delim = detectDelimiter(text);
    return lines.map(line => {
        const parts = line.split(delim).map(p => p.trim());
        const obj = {};
        FIELDS.forEach((f, i) => { obj[f] = parts[i] || ""; });
        return obj;
    }).filter(r => r.email && r.email.includes("@"));
}

function smartImportPreview() {
    const text = document.getElementById("importMailRows")?.value || "";
    _smartImportRows = parseSmartImport(text);

    const previewEl  = document.getElementById("importPreview");
    const confirmBtn = document.getElementById("importConfirmBtn");
    if (!previewEl) return;

    if (!_smartImportRows.length) {
        previewEl.innerHTML = "";
        if (confirmBtn) confirmBtn.style.display = "none";
        return;
    }

    const LABELS = ["Email","Password","IMAP Host","Port","IMAP User","IMAP Pass","Secure"];
    const KEYS   = ["email","password","imapHost","imapPort","imapUser","imapPass","secure"];

    let html = `<div class="import-preview-header">Xem trước — ${_smartImportRows.length} dòng</div>`;
    html += `<div class="import-table-wrap"><table class="import-preview-table">`;
    html += `<thead><tr>${LABELS.map(l => `<th>${l}</th>`).join("")}</tr></thead><tbody>`;

    const rows = _smartImportRows.slice(0, 10);
    rows.forEach(row => {
        html += `<tr>${KEYS.map(k => `<td>${escapeHtml(row[k] || "")}</td>`).join("")}</tr>`;
    });
    if (_smartImportRows.length > 10) {
        html += `<tr><td colspan="${KEYS.length}" class="preview-more">... và ${_smartImportRows.length - 10} dòng nữa</td></tr>`;
    }
    html += `</tbody></table></div>`;
    previewEl.innerHTML = html;

    if (confirmBtn) {
        confirmBtn.style.display = "";
        confirmBtn.textContent = `Import ${_smartImportRows.length} dòng`;
    }
}

async function confirmSmartImport() {
    if (!_smartImportRows.length) return;
    const btn = document.getElementById("importConfirmBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Đang import..."; }
    const rows = _smartImportRows.map(r =>
        [r.email, r.password, r.imapHost, r.imapPort, r.imapUser, r.imapPass, r.secure].join("|")
    ).join("\n");
    try {
        const res = await adminFetch("/api/accounts/import-mail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message); return; }
        showToast(`Tạo mới: ${data.created}, Cập nhật: ${data.updated}`);
        document.getElementById("importMailRows").value = "";
        document.getElementById("importPreview").innerHTML = "";
        _smartImportRows = [];
        if (btn) btn.style.display = "none";
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
    finally { if (btn) { btn.disabled = false; btn.textContent = `Import ${_smartImportRows.length} dòng`; } }
}

function downloadTemplate() {
    const lines = [
        "email|password|imapHost|imapPort|imapUser|imapPass|secure",
        "abc@gmail.com|matkhau|imap.gmail.com|993|abc@gmail.com|app-password-16-chars|true",
        "xyz@gmail.com|matkhau2||||app-password-2|"
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "import-template.txt"; a.click();
    URL.revokeObjectURL(url);
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportAccounts() {
    if (!filteredAccounts.length) { alert("Không có dữ liệu"); return; }
    let csv = "Email,Password,TrangThai,WeChatID,NgayTaoWeChat,HetHan\n";
    filteredAccounts.forEach(a => {
        const d = calcDaysLeft(a.wechatCreatedAt);
        const hetHan = d === null ? "" : d >= 0 ? `${d} ngày` : "Hết hạn";
        const ngay = a.wechatCreatedAt ? new Date(a.wechatCreatedAt).toLocaleDateString("vi-VN") : "";
        csv += `"${c(a.email)}","${c(a.password)}","${c(a.status)}","${c(a.wechatId)}","${ngay}","${hetHan}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "accounts.csv"; link.click();
    URL.revokeObjectURL(url);
}
function c(v) { return String(v || "").replace(/"/g, '""'); }

// ─── Worker ───────────────────────────────────────────────────────────────────

async function loadWorkerStatus() {
    try {
        const res = await adminFetch("/api/worker/status");
        const data = await safeJson(res);
        const badge = document.getElementById("workerStatusBadge");
        const info  = document.getElementById("workerInfo");

        // Update IMAP error map & refresh health list if on settings page
        if (data.accountErrors) {
            imapAccountErrors = data.accountErrors;
            renderImapHealth();
        }

        if (!badge || !info) return;
        if (res.ok && data.running) {
            badge.textContent = "ONLINE"; badge.className = "worker-badge online";
            const errCount = Object.keys(imapAccountErrors).length;
            info.innerHTML = `Worker đang chạy — Accounts: <b>${data.activeAccounts || 0}</b> | Last run: <b>${data.lastRunAt || "-"}</b>${errCount ? ` | <span style="color:var(--red)">IMAP lỗi: ${errCount}</span>` : ""}`;
        } else {
            badge.textContent = "OFFLINE"; badge.className = "worker-badge offline";
            info.textContent = "Worker chưa chạy.";
        }
    } catch (err) { if (err.message !== "Session expired") console.error(err); }

    // Cập nhật Tunnel URL
    try {
        const cfgRes = await fetch("/api/config");
        const cfg = await cfgRes.json();
        const bar  = document.getElementById("tunnelUrlBar");
        const link = document.getElementById("tunnelUrlLink");
        if (cfg.publicUrl && bar && link) {
            publicBaseUrl = cfg.publicUrl;
            link.href        = cfg.publicUrl;
            link.textContent = cfg.publicUrl;
            bar.style.display = "";
        } else if (bar) {
            bar.style.display = "none";
        }
    } catch { /* bỏ qua nếu tunnel chưa chạy */ }
}

async function startWorker() {
    try {
        const res = await adminFetch("/api/worker/start", { method: "POST" });
        if (res.ok) { await loadWorkerStatus(); alert("Worker đã start"); }
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function stopWorker() {
    try {
        const res = await adminFetch("/api/worker/stop", { method: "POST" });
        if (res.ok) { await loadWorkerStatus(); alert("Worker đã stop"); }
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

async function reloadWorker() {
    try {
        const res = await adminFetch("/api/worker/reload", { method: "POST" });
        if (res.ok) { await loadWorkerStatus(); alert("Reload thành công"); }
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function saveSettings() {
    const currentPassword = document.getElementById("st_currentPass").value.trim();
    const newUsername     = document.getElementById("st_newUser").value.trim();
    const newPassword     = document.getElementById("st_newPass").value.trim();
    const confirmPassword = document.getElementById("st_confirmPass").value.trim();
    const errEl = document.getElementById("st_error");

    errEl.style.display = "none";

    if (!currentPassword || !newUsername || !newPassword || !confirmPassword) {
        errEl.textContent = "Vui lòng điền đầy đủ thông tin"; errEl.style.display = "block"; return;
    }
    if (newPassword !== confirmPassword) {
        errEl.textContent = "Mật khẩu mới không khớp"; errEl.style.display = "block"; return;
    }
    if (newPassword.length < 6) {
        errEl.textContent = "Mật khẩu mới phải có ít nhất 6 ký tự"; errEl.style.display = "block"; return;
    }

    const btn = document.getElementById("st_saveBtn");
    btn.disabled = true; btn.textContent = "Đang lưu...";

    try {
        const res = await adminFetch("/api/settings/credentials", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newUsername, newPassword })
        });
        const data = await safeJson(res);
        if (!res.ok) { errEl.textContent = data.message; errEl.style.display = "block"; return; }

        showToast("Đã cập nhật — vui lòng đăng nhập lại");
        setTimeout(() => {
            localStorage.removeItem("adminToken");
            window.location.replace("/login.html");
        }, 1500);
    } catch (err) { if (err.message !== "Session expired") { errEl.textContent = "Lỗi kết nối"; errEl.style.display = "block"; } }
    finally { btn.disabled = false; btn.textContent = "Lưu"; }
}

async function saveWorkerConfig() {
    const workerUrl    = document.getElementById("st_workerUrl")?.value.trim() || "";
    const workerSecret = document.getElementById("st_workerSecret")?.value.trim() || "";
    const errEl = document.getElementById("st_workerError");
    if (errEl) errEl.style.display = "none";

    if (!workerUrl) {
        if (errEl) { errEl.textContent = "Vui lòng nhập Worker URL"; errEl.style.display = "block"; }
        return;
    }

    const btn = document.getElementById("st_workerSaveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Đang lưu..."; }

    try {
        const res = await adminFetch("/api/settings/worker", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workerUrl, workerSecret })
        });
        const data = await safeJson(res);
        if (!res.ok) {
            if (errEl) { errEl.textContent = data.message; errEl.style.display = "block"; }
            return;
        }
        workerBaseUrl = workerUrl;
        showToast("Đã lưu Worker config");
        // Update secret placeholder
        if (workerSecret) {
            const ws = document.getElementById("st_workerSecret");
            if (ws) { ws.value = ""; ws.placeholder = "Secret đã lưu — để trống để giữ nguyên"; }
        }
    } catch (err) {
        if (err.message !== "Session expired") {
            if (errEl) { errEl.textContent = "Lỗi kết nối"; errEl.style.display = "block"; }
        }
    }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Lưu"; } }
}

// ─── IMAP Modal ───────────────────────────────────────────────────────────────

let _imapTargetId = "";

function editImap(id, currentUser, currentHost) {
    _imapTargetId = id;
    document.getElementById("mi_host").value = currentHost || "imap.gmail.com";
    document.getElementById("mi_user").value = currentUser || "";
    document.getElementById("mi_pass").value = "";
    document.getElementById("imapModal").style.display = "flex";
    setTimeout(() => document.getElementById("mi_pass").focus(), 80);
}

function closeImapModal() {
    document.getElementById("imapModal").style.display = "none";
    _imapTargetId = "";
}

async function saveImap() {
    const host      = document.getElementById("mi_host").value.trim();
    const user      = document.getElementById("mi_user").value.trim();
    const pass      = document.getElementById("mi_pass").value.trim();
    const applyAll  = document.getElementById("mi_applyAll")?.checked ?? true;
    const passInput = document.getElementById("mi_pass");

    if (!host || !user || !pass) {
        passInput.style.borderColor = "#ef4444";
        setTimeout(() => passInput.style.borderColor = "", 1500);
        return;
    }

    const btn = document.getElementById("imapSaveBtn");
    btn.disabled = true; btn.textContent = "Đang lưu...";

    const payload = { imapHost: host, imapUser: user, imapPass: pass, imapPort: 993, imapSecure: true };

    try {
        let res;
        if (applyAll) {
            // Cập nhật tất cả variants cùng Gmail gốc
            res = await adminFetch("/api/accounts/update-imap-bulk", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } else {
            // Chỉ cập nhật 1 account
            res = await adminFetch("/api/accounts/update-imap/" + _imapTargetId, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }

        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }

        const msg = applyAll && data.count > 1
            ? `Đã cập nhật IMAP cho ${data.count} tài khoản`
            : "Đã lưu IMAP";
        showToast(msg);
        closeImapModal();
        await loadAccounts();
    } catch (err) { if (err.message !== "Session expired") alert("Lỗi kết nối"); }
    finally { btn.disabled = false; btn.textContent = "Lưu"; }
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
            document.body.appendChild(ta);
            ta.select(); document.execCommand("copy");
            document.body.removeChild(ta);
        }
        showToast("Đã copy!");
    } catch { showToast("Copy thất bại", true); }
}

function showToast(msg, isError = false) {
    let t = document.getElementById("toast");
    if (!t) {
        t = document.createElement("div");
        t.id = "toast";
        t.className = "toast-popup";
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isError ? "#ef4444" : "#10b981";
    t.classList.remove("toast-show");
    void t.offsetWidth;
    t.classList.add("toast-show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.classList.remove("toast-show"); }, 2000);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

async function safeJson(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : {}; }
    catch { return { message: text || "Lỗi server" }; }
}

function escapeHtml(v) {
    return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
        .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function escapeJs(v) {
    return String(v).replaceAll("\\","\\\\").replaceAll("'","\\'")
        .replaceAll('"','\\"').replaceAll("\n","\\n").replaceAll("\r","\\r");
}
