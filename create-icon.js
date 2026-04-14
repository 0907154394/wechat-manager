/**
 * Tạo icon app WeChat Manager (assets/icon.png + assets/icon.ico)
 * Chạy: node create-icon.js
 * Không cần cài thêm package — dùng Node.js built-in zlib.
 */

const zlib = require("zlib");
const fs   = require("fs");
const path = require("path");

const SIZE = 256;
const rgba = new Uint8Array(SIZE * SIZE * 4);

// ── Pixel helpers ─────────────────────────────────────────────────────────

function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    const fa = a / 255;
    rgba[i]   = Math.round(rgba[i]   * (1 - fa) + r * fa);
    rgba[i+1] = Math.round(rgba[i+1] * (1 - fa) + g * fa);
    rgba[i+2] = Math.round(rgba[i+2] * (1 - fa) + b * fa);
    rgba[i+3] = 255;
}

function fillAll(r, g, b) {
    for (let i = 0; i < SIZE * SIZE * 4; i += 4) {
        rgba[i] = r; rgba[i+1] = g; rgba[i+2] = b; rgba[i+3] = 255;
    }
}

function fillCircle(cx, cy, radius, r, g, b, alpha = 255) {
    const r2 = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(SIZE - 1, Math.ceil(cy + radius)); y++) {
        for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(SIZE - 1, Math.ceil(cx + radius)); x++) {
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (dist <= radius) {
                const aa = dist > radius - 1.5 ? Math.max(0, 1 - (dist - (radius - 1.5)) / 1.5) : 1;
                setPixel(x, y, r, g, b, Math.round(aa * alpha));
            }
        }
    }
}

// Vẽ đường thẳng dày bằng cách stamp circles dọc theo path
function drawLine(x0, y0, x1, y1, thickness, r, g, b) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 1.5);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        fillCircle(x0 + dx * t, y0 + dy * t, thickness / 2, r, g, b);
    }
}

// Rounded rectangle
function fillRoundRect(x, y, w, h, rx, r, g, b) {
    // Fill center columns
    for (let py = y + rx; py < y + h - rx; py++)
        for (let px = x; px < x + w; px++)
            setPixel(px, py, r, g, b);
    // Fill top/bottom strips
    for (let py = y; py < y + rx; py++)
        for (let px = x + rx; px < x + w - rx; px++)
            setPixel(px, py, r, g, b);
    for (let py = y + h - rx; py < y + h; py++)
        for (let px = x + rx; px < x + w - rx; px++)
            setPixel(px, py, r, g, b);
    // Four corners
    fillCircle(x + rx,     y + rx,     rx, r, g, b);
    fillCircle(x + w - rx, y + rx,     rx, r, g, b);
    fillCircle(x + rx,     y + h - rx, rx, r, g, b);
    fillCircle(x + w - rx, y + h - rx, rx, r, g, b);
}

// ── Vẽ icon ───────────────────────────────────────────────────────────────

// 1. Nền tối #0f1e35
fillAll(15, 30, 53);

// 2. Hình tròn ngoài — viền sáng hơn #1e3a5f
fillCircle(128, 128, 112, 30, 58, 95);

// 3. Hình tròn trong — nền xanh #1a3a6e
fillCircle(128, 128, 104, 26, 58, 110);

// 4. Gradient ring — highlight trên cùng
for (let y = 24; y < 128; y++) {
    for (let x = 24; x < 232; x++) {
        const dist = Math.sqrt((x - 128) ** 2 + (y - 128) ** 2);
        if (dist <= 104) {
            const t = 1 - (y - 24) / 104;
            const extra = Math.round(t * 20);
            const i = (y * SIZE + x) * 4;
            rgba[i]   = Math.min(255, rgba[i]   + extra);
            rgba[i+1] = Math.min(255, rgba[i+1] + extra);
            rgba[i+2] = Math.min(255, rgba[i+2] + extra);
        }
    }
}

// 5. Chữ "W" trắng
//    5 điểm: top-left, top-right, bottom-left, center, bottom-right
const T  = 20; // độ dày nét
const WW = 255, WG = 255, WB = 255;

//   TL(66,78) ── xuống ──> BL(94,178)
//   BL(94,178) ── lên ──> MID(128,138)
//   MID(128,138) ── xuống ──> BR(162,178)
//   BR(162,178) ── lên ──> TR(190,78)
drawLine(66, 78,  94, 178, T, WW, WG, WB);
drawLine(94, 178, 128, 138, T, WW, WG, WB);
drawLine(128, 138, 162, 178, T, WW, WG, WB);
drawLine(162, 178, 190, 78, T, WW, WG, WB);

// 6. Chấm nhỏ trang trí dưới chữ W
fillCircle(128, 195, 7, 100, 180, 255);

// ── Build PNG ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
    const len   = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, "ascii");
    const crcB  = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
    return Buffer.concat([len, typeB, data, crcB]);
}

function buildPNG(width, height, pixels) {
    const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // RGBA

    // Raw scanlines: 1 filter byte + 4 bytes/pixel
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + width * 4)] = 0; // no filter
        for (let x = 0; x < width; x++) {
            const s = (y * width + x) * 4;
            const d = y * (1 + width * 4) + 1 + x * 4;
            raw[d]   = pixels[s];
            raw[d+1] = pixels[s+1];
            raw[d+2] = pixels[s+2];
            raw[d+3] = pixels[s+3];
        }
    }

    return Buffer.concat([
        sig,
        makeChunk("IHDR", ihdrData),
        makeChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
        makeChunk("IEND", Buffer.alloc(0))
    ]);
}

// ── Ghi file ─────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, "assets");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const pngData = buildPNG(SIZE, SIZE, rgba);
const pngPath = path.join(outDir, "icon.png");
fs.writeFileSync(pngPath, pngData);
console.log("✓ assets/icon.png");

// ICO: wrap PNG trực tiếp (chuẩn ICO cho size 256x256)
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: ICO
icoHeader.writeUInt16LE(1, 4); // 1 image

const dirEntry = Buffer.alloc(16);
dirEntry[0] = 0;  // width  0 = 256
dirEntry[1] = 0;  // height 0 = 256
dirEntry[2] = 0;  // palette
dirEntry[3] = 0;  // reserved
dirEntry.writeUInt16LE(1,  4);  // color planes
dirEntry.writeUInt16LE(32, 6);  // bpp
dirEntry.writeUInt32LE(pngData.length, 8);   // data size
dirEntry.writeUInt32LE(22, 12);              // offset (6 + 16)

const icoPath = path.join(outDir, "icon.ico");
fs.writeFileSync(icoPath, Buffer.concat([icoHeader, dirEntry, pngData]));
console.log("✓ assets/icon.ico");

console.log("\nXong! Chạy 'npm run electron' để thử app.");
