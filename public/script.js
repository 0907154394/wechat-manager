let allAccounts = [];
let filteredAccounts = [];
let selectedIds = new Set();
let currentPage = 1;
let PAGE_SIZE = 50;
let selectedExcelFile = null;
let workerBaseUrl = "";   // Cloudflare Worker URL (stable)

// ─── Sidebar toggle ───────────────────────────────────────────────────────────

function toggleSidebar() {
    const shell = document.querySelector(".page-shell");
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
}

function initSidebar() {
    if (localStorage.getItem("sidebarCollapsed") === "1") {
        document.querySelector(".page-shell")?.classList.add("sidebar-collapsed");
    }
}

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

        // Load Google Client Credentials Info
        const resGoogle = await adminFetch("/api/settings/gmail-client");
        const dataGoogle = await safeJson(resGoogle);
        const googleJson = document.getElementById("st_googleJson");
        if (googleJson) {
            if (dataGoogle.hasCredentials) {
                googleJson.value = "";
                googleJson.placeholder = `Client ID đã cấu hình: ${dataGoogle.clientId}\n\nDán nội dung credentials.json mới vào đây để cập nhật...`;
            } else {
                googleJson.value = "";
                googleJson.placeholder = `{"web":{"client_id":"...", "client_secret":"..."}}`;
            }
        }
    } catch { /* ignore */ }
    renderGmailHealth();
}

// Google API Credentials Functions
function loadGoogleFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById("st_googleJson").value = e.target.result;
    };
    reader.readAsText(file);
}

async function saveGoogleCredentials() {
    const jsonText = document.getElementById("st_googleJson").value.trim();
    const errEl = document.getElementById("st_googleError");
    if (errEl) errEl.style.display = "none";

    if (!jsonText) {
        if (errEl) { errEl.textContent = "Vui lòng nhập nội dung JSON hoặc chọn file"; errEl.style.display = "block"; }
        return;
    }

    const btn = document.getElementById("st_googleSaveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Đang lưu..."; }

    try {
        const res = await adminFetch("/api/settings/gmail-client", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ configText: jsonText })
        });
        const data = await safeJson(res);
        if (!res.ok) {
            if (errEl) { errEl.textContent = data.message; errEl.style.display = "block"; }
            return;
        }
        showToast("Đã lưu Google Credentials");
        const fileInput = document.getElementById("st_googleFile");
        if (fileInput) fileInput.value = "";
        
        // Refresh settings to show updated placeholder
        await loadSettingsSection();
    } catch (err) {
        if (err.message !== "Session expired") {
            if (errEl) { errEl.textContent = "Lỗi kết nối"; errEl.style.display = "block"; }
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Lưu Credentials"; }
    }
}

function normalizeGmailLocal(email) {
    const parts = email.toLowerCase().split("@");
    if (parts.length !== 2) return email.toLowerCase();
    const [local, domain] = parts;
    if (domain === "gmail.com" || domain === "googlemail.com") {
        return local.replace(/\./g, "") + "@" + domain;
    }
    return email.toLowerCase();
}

function renderGmailHealth() {
    const el = document.getElementById("gmailHealthList");
    if (!el) return;
    const errors = allAccounts.filter(a => a.gmailError);
    if (!errors.length) {
        el.innerHTML = '<span class="health-ok">Tất cả Gmail API hoạt động bình thường.</span>';
        return;
    }
    // Group by base email — tất cả variant cùng Gmail gốc chỉ hiện 1 dòng
    const groups = new Map();
    for (const a of errors) {
        const key = normalizeGmailLocal(a.email);
        if (!groups.has(key)) groups.set(key, { msg: a.gmailError, count: 0 });
        groups.get(key).count++;
    }
    el.innerHTML = [...groups.entries()].map(([user, { msg, count }]) => `
        <div class="health-error-item">
            <div class="health-error-row">
                <div>
                    <span class="health-user">${escapeHtml(user)}</span>
                    ${count > 1 ? `<span class="health-count">${count} tài khoản</span>` : ""}
                    <span class="health-msg">${escapeHtml(msg)}</span>
                </div>
                <button class="link-btn health-fix-btn" onclick="editGmailByUser('${escapeJs(user)}')">Sửa Gmail API</button>
            </div>
        </div>`).join("");
}

function editGmailByUser(gmailUser) {
    const acc = allAccounts.find(a => normalizeGmailLocal(a.email) === normalizeGmailLocal(gmailUser));
    if (!acc) { showToast("Không tìm thấy tài khoản này"); return; }
    editGmail(acc._id, acc.email);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

window.onload = async () => {
    initSidebar();
    bindFileDrop();
    await loadConfig();
    await loadAccounts();
    await loadWorkerStatus();

    // Tự động làm mới danh sách mỗi 60 giây:
    // - Cập nhật bộ đếm "còn X phút" trên UI
    // - Tạo link mới thay thế link đã hết hạn (server tự gia hạn)
    setInterval(async () => {
        await loadAccounts(false);
    }, 60 * 1000);
};

async function loadConfig() {
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

async function loadAccounts(resetPage = true) {
    try {
        const url = isArchivedView ? "/api/accounts?archived=true" : "/api/accounts";
        const res = await adminFetch(url);
        const data = await safeJson(res);
        if (!res.ok) { showToast(data.message || "Không tải được dữ liệu", true); return; }
        allAccounts = Array.isArray(data) ? data : [];
        filteredAccounts = [...allAccounts];
        if (resetPage) currentPage = 1;
        renderTable(filteredAccounts);
        updateStats(allAccounts);
        renderGmailHealth();
    } catch (err) {
        if (err.message !== "Session expired") { console.error(err); showToast("Lỗi kết nối server", true); }
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
        const linkBase = workerBaseUrl || window.location.origin;
        const fullLink = a.linkToken ? linkBase + a.linkToken : "";
        const checked = selectedIds.has(a._id) ? "checked" : "";
        const gmailUser = escapeJs(a.email || "");
        const hasGmailErr = !!(a.gmailError);
        const errTitle = hasGmailErr ? escapeHtml(a.gmailError) : "";

        html += `
        <tr>
            <td><input type="checkbox" ${checked} onchange="toggleSelect('${a._id}', this.checked)"></td>
            <td>${globalIdx + 1}</td>

            <td>
                <div class="token-stack">
                    <div style="display:flex;align-items:center;justify-content:center;gap:4px">
                        <span class="copy-text">${escapeHtml(a.email || "")}</span>
                        ${hasGmailErr ? `<span class="gmail-err-dot" title="${errTitle}">!</span>` : (a.gmailApiEnabled ? `<span class="api-connected-dot" title="Gmail API Connected" style="background:#10b981;color:#fff;border-radius:50%;width:8px;height:8px;display:inline-block;margin-left:4px;vertical-align:middle"></span>` : "")}
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

            <td>
                <div class="action-group">
                ${isArchivedView ? `
                <button class="sell-btn" onclick="restoreAccount('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>Khôi phục</button>
                <button class="delete-btn" onclick="hardDeleteAccount('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>Xóa cứng</button>
                ` : `
                ${a.status === "DA BAN"
                    ? `<button class="unsell-btn" onclick="unsell('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>Hủy bán</button>`
                    : `<button class="sell-btn" onclick="sell('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><polyline points="20 6 9 17 4 12"/></svg>Bán</button>`}
                <button class="wechat-btn" onclick="updateWechatId('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:3px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>WeChat ID</button>
                <button class="link-btn" onclick="viewMessages('${a.messageToken || ""}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>OTP</button>
                <button class="gen-link-btn" onclick="generateLink('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Tạo link</button>
                <button class="link-btn" onclick="editGmail('${a._id}', '${gmailUser}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>Gmail API</button>
                <button class="delete-btn" onclick="deleteAccount('${a._id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>Lưu trữ</button>
                `}
                </div>
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

    if (!baseEmail) { alert("Vui lòng nhập email gốc"); return; }
    if (!quantity || quantity < 1) { alert("Vui lòng nhập số lượng"); return; }

    const btn = document.querySelector(".create-row button");
    if (btn) { btn.disabled = true; btn.textContent = "Đang tạo..."; }

    try {
        const res = await adminFetch("/api/accounts/create-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseEmail, quantity })
        });
        const data = await safeJson(res);
        if (!res.ok) { alert(data.message || "Lỗi"); return; }

        const count = Array.isArray(data) ? data.length : 0;
        let msg = `Đã tạo ${count} variants thành công.`;
        alert(msg);
        ["baseEmail","quantity"].forEach(id => {
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
    const FIELDS = ["email","password"];
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

    const LABELS = ["Email","Password"];
    const KEYS   = ["email","password"];

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
        [r.email, r.password].join("|")
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
        "email|password",
        "abc@gmail.com|matkhau",
        "xyz@gmail.com|matkhau2"
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

function exportForWechatShop() {
    const toExport = filteredAccounts.filter(a => a.messageToken);
    if (!toExport.length) { alert("Không có account nào có messageToken. Hãy tạo link trước."); return; }
    // Format: wechatId|password|messageToken|email  (pipe-separated, one per line)
    const lines = toExport.map(a =>
        [a.wechatId || a.email, a.password || "", a.messageToken || "", a.email || ""].join("|")
    );
    const text = lines.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "wechat-shop-import.txt"; link.click();
    URL.revokeObjectURL(url);
    showToast(`Đã export ${toExport.length} account cho WeChat Shop`);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function loadWorkerStatus() {
    try {
        const res = await adminFetch("/api/worker/status");
        const data = await safeJson(res);
        const badge = document.getElementById("workerStatusBadge");
        const info  = document.getElementById("workerInfo");

        if (!badge || !info) return;
        if (res.ok && data.running) {
            badge.textContent = "ONLINE"; badge.className = "worker-badge online";
            const errCount = allAccounts.filter(a => a.gmailError).length;
            info.innerHTML = `Worker đang chạy — Accounts: <b>${data.activeAccounts || 0}</b> | Last run: <b>${data.lastRunAt || "-"}</b>${errCount ? ` | <a class="gmail-err-link" onclick="goToGmailHealth()">Gmail lỗi: ${errCount}</a>` : ""}`;
        } else {
            badge.textContent = "OFFLINE"; badge.className = "worker-badge offline";
            info.textContent = "Worker chưa chạy.";
        }
    } catch (err) { if (err.message !== "Session expired") console.error(err); }

}

async function generateLink(id) {
    try {
        const res = await adminFetch(`/api/accounts/${id}/generate-link`, { method: "POST" });
        if (res.ok) {
            await loadAccounts();
            showToast("Đã tạo link mới");
        } else {
            showToast("Lỗi tạo link");
        }
    } catch (err) { if (err.message !== "Session expired") showToast("Lỗi kết nối"); }
}

function goToGmailHealth() {
    showSection("settings");
    setTimeout(() => {
        const el = document.getElementById("gmailHealthList");
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.closest(".card").classList.add("card-highlight");
            setTimeout(() => el.closest(".card").classList.remove("card-highlight"), 1500);
        }
    }, 120);
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

// ─── Gmail API Modal ───────────────────────────────────────────────────────────

let _gmailTargetId = "";

function editGmail(id, currentUser) {
    _gmailTargetId = id;
    const errEl = document.getElementById("mi_error");
    if (errEl) errEl.style.display = "none";
    document.getElementById("mi_user").value = currentUser || "";
    document.getElementById("gmailModal").style.display = "flex";
}

function closeGmailModal() {
    document.getElementById("gmailModal").style.display = "none";
    _gmailTargetId = "";
}

async function connectGmailApi() {
    const user = document.getElementById("mi_user").value.trim();
    const errEl = document.getElementById("mi_error");
    if (errEl) errEl.style.display = "none";

    if (!user) {
        if (errEl) { errEl.textContent = "Thiếu Gmail cần liên kết"; errEl.style.display = "block"; }
        return;
    }

    const btn = document.getElementById("gmailSaveBtn");
    btn.disabled = true; btn.textContent = "Đang xử lý...";

    try {
        const res = await adminFetch(`/api/accounts/google-auth-url?email=${encodeURIComponent(user)}`);
        const data = await safeJson(res);
        if (!res.ok) {
            if (errEl) { errEl.textContent = data.message; errEl.style.display = "block"; }
            return;
        }

        if (data.authUrl) {
            window.open(data.authUrl, "_blank");
            closeGmailModal();
            showToast("Đã mở trang xác thực Google trong tab mới.");
        } else {
            if (errEl) { errEl.textContent = "Không lấy được Auth URL"; errEl.style.display = "block"; }
        }
    } catch (err) {
        if (err.message !== "Session expired") {
            if (errEl) { errEl.textContent = "Lỗi kết nối"; errEl.style.display = "block"; }
        }
    } finally {
        btn.disabled = false; btn.textContent = "Kết nối";
    }
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
