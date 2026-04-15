/**
 * Cloudflare Worker — OTP Relay
 * KV namespace: OTP_KV  (bind trong Cloudflare Dashboard)
 * Env secret:   PUSH_SECRET (set trong Cloudflare Dashboard → Settings → Variables)
 *
 * Routes:
 *   GET  /c/:linkToken        → Trang OTP cho khách hàng
 *   POST /api/push            → Desktop app đẩy OTP mới lên (yêu cầu secret)
 *   POST /api/link            → Desktop app đăng ký linkToken mới (yêu cầu secret)
 */

export default {
    async fetch(request, env) {
        const url  = new URL(request.url);
        const path = url.pathname;

        // ── Trang OTP cho khách hàng ──────────────────────────────────────
        if (request.method === "GET" && path.startsWith("/c/")) {
            const linkToken = path.slice(3).trim();
            if (!linkToken) return html(404, pageNotFound());

            const linkRaw = await env.OTP_KV.get(`link:${linkToken}`, "json");

            if (!linkRaw || linkRaw.expiresAt < Date.now()) {
                if (linkRaw) await env.OTP_KV.delete(`link:${linkToken}`);
                return html(410, pageExpired());
            }

            const msgRaw = await env.OTP_KV.get(`msg:${linkRaw.messageToken}`, "json");
            if (!msgRaw) return html(404, pageNoData());

            return html(200, pageOtp(msgRaw));
        }

        // ── Xác thực secret cho các route admin ──────────────────────────
        const auth = request.headers.get("Authorization") || "";
        if (auth !== `Bearer ${env.PUSH_SECRET}`) {
            return new Response("Unauthorized", { status: 401 });
        }

        // ── Push OTP mới từ desktop app ───────────────────────────────────
        if (request.method === "POST" && path === "/api/push") {
            const { messageToken, content, email } = await request.json();
            if (!messageToken || !content) {
                return new Response("Missing fields", { status: 400 });
            }
            await env.OTP_KV.put(
                `msg:${messageToken}`,
                JSON.stringify({ content, email: email || "", updatedAt: Date.now() })
            );
            return new Response("OK");
        }

        // ── Đăng ký linkToken mới từ desktop app ─────────────────────────
        if (request.method === "POST" && path === "/api/link") {
            const { linkToken, messageToken, expiresAt } = await request.json();
            if (!linkToken || !messageToken) {
                return new Response("Missing fields", { status: 400 });
            }
            const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
            await env.OTP_KV.put(
                `link:${linkToken}`,
                JSON.stringify({ messageToken, expiresAt }),
                { expirationTtl: ttl }
            );
            return new Response("OK");
        }

        return new Response("Not Found", { status: 404 });
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────
function html(status, body) {
    return new Response(body, {
        status,
        headers: { "Content-Type": "text/html;charset=utf-8" }
    });
}

function shell(content) {
    return `<!DOCTYPE html><html lang="vi"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WeChat Manager</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#060c18;color:#dde6f5;
     min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#0f1e35;border:1px solid rgba(99,130,220,.2);border-radius:20px;
      padding:36px 32px;max-width:440px;width:100%;text-align:center;
      box-shadow:0 20px 60px rgba(0,0,0,.5)}
.logo{width:52px;height:52px;background:linear-gradient(135deg,#5b7cf7,#a78bfa);
      border-radius:14px;display:inline-flex;align-items:center;justify-content:center;
      font-size:22px;font-weight:900;color:#fff;margin-bottom:16px}
h2{font-size:16px;color:#7e96b8;font-weight:500;margin-bottom:24px}
${content.css || ""}
</style></head><body>
<div class="card">
  <div class="logo">W</div>
  ${content.body}
</div>
</body></html>`;
}

function pageOtp(data) {
    const lines = (data.content || "").split(/\n/).filter(Boolean);
    const codeMatch = data.content.match(/\b(\d{4,8})\b/);
    const code = codeMatch ? codeMatch[1] : null;
    const ago = Math.round((Date.now() - data.updatedAt) / 60000);
    const agoText = ago < 1 ? "Vừa xong" : `${ago} phút trước`;

    return shell({
        css: `.otp-code{font-size:52px;font-weight:900;letter-spacing:10px;color:#5b7cf7;
              background:rgba(91,124,247,.08);border-radius:14px;padding:20px 28px;
              margin:20px 0;border:2px solid rgba(91,124,247,.25)}
             .content{font-size:14px;color:#7e96b8;line-height:1.7;text-align:left;
              background:#060c18;border-radius:10px;padding:14px;margin-bottom:16px;
              max-height:160px;overflow-y:auto}
             .meta{font-size:12px;color:#3d5a7a;margin-top:8px}
             .refresh{display:inline-block;margin-top:16px;padding:10px 24px;
              background:linear-gradient(135deg,#5b7cf7,#4a6de8);color:#fff;
              border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;
              font-family:inherit}`,
        body: `<h2>Mã xác nhận của bạn</h2>
               ${code ? `<div class="otp-code">${code}</div>` : ""}
               <div class="content">${lines.map(l => `<div>${escHtml(l)}</div>`).join("")}</div>
               <div class="meta">Cập nhật: ${agoText}</div>
               <button class="refresh" onclick="location.reload()">Làm mới</button>`
    });
}

function pageExpired() {
    return shell({
        css: `.icon{font-size:48px;margin-bottom:12px}h3{color:#fb923c;font-size:20px;
              font-weight:700;margin-bottom:8px}p{color:#7e96b8;font-size:14px}`,
        body: `<div class="icon">⏱</div>
               <h3>Link đã hết hạn</h3>
               <p>Link này đã hết hạn sau 1 giờ.<br>Vui lòng liên hệ người bán để nhận link mới.</p>`
    });
}

function pageNotFound() {
    return shell({
        css: `.icon{font-size:48px;margin-bottom:12px}h3{color:#ef4444;font-size:20px;
              font-weight:700;margin-bottom:8px}p{color:#7e96b8;font-size:14px}`,
        body: `<div class="icon">❌</div>
               <h3>Link không hợp lệ</h3>
               <p>Link này không tồn tại hoặc đã bị xoá.<br>Vui lòng liên hệ người bán.</p>`
    });
}

function pageNoData() {
    return shell({
        css: `.icon{font-size:48px;margin-bottom:12px}h3{color:#7e96b8;font-size:20px;
              font-weight:700;margin-bottom:8px}p{color:#4d6a91;font-size:14px}`,
        body: `<div class="icon">📭</div>
               <h3>Chưa có mã nào</h3>
               <p>Chưa nhận được mã xác nhận nào.<br>Vui lòng thử lại sau ít phút.</p>`
    });
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
