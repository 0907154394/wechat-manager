/**
 * Tạo icon app WeChat Manager (assets/icon.png + assets/icon.ico)
 * Chạy: node create-icon.js
 */

const zlib = require("zlib");
const fs   = require("fs");
const path = require("path");

const SIZE = 256;
const rgba = new Uint8Array(SIZE * SIZE * 4); // transparent by default

// ── Pixel helpers ─────────────────────────────────────────────────────────

function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    const fa = a / 255;
    rgba[i]   = Math.round(rgba[i]   * (1 - fa) + r * fa);
    rgba[i+1] = Math.round(rgba[i+1] * (1 - fa) + g * fa);
    rgba[i+2] = Math.round(rgba[i+2] * (1 - fa) + b * fa);
    rgba[i+3] = Math.min(255, rgba[i+3] + Math.round(fa * 255));
}

// Trả về 0.0 (ngoài) → 1.0 (trong) kèm AA cho cạnh
function roundRectAlpha(px, py, x, y, w, h, r) {
    if (px < x || px > x + w || py < y || py > y + h) return 0;
    // Xác định góc gần nhất
    const cx = px < x + r ? x + r : (px > x + w - r ? x + w - r : px);
    const cy = py < y + r ? y + r : (py > y + h - r ? y + h - r : py);
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (dist <= r - 1) return 1;
    if (dist <= r + 1) return Math.max(0, (r + 1 - dist) / 2);
    return (cx === px && cy === py) ? 1 : 0;
}

function drawLine(x0, y0, x1, y1, thickness, r, g, b) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = x0 + dx * t, cy = y0 + dy * t;
        const rad = thickness / 2;
        for (let py = Math.floor(cy - rad); py <= Math.ceil(cy + rad); py++) {
            for (let px = Math.floor(cx - rad); px <= Math.ceil(cx + rad); px++) {
                const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                if (d <= rad) {
                    const aa = d > rad - 1 ? Math.max(0, 1 - (d - (rad - 1))) : 1;
                    setPixel(px, py, r, g, b, Math.round(aa * 255));
                }
            }
        }
    }
}

// ── Vẽ icon ───────────────────────────────────────────────────────────────

const PAD = 10;  // padding từ mép
const RAD = 54;  // corner radius (tương đương ~21%)

// 1. Rounded square với gradient tím #5b7cf7 → #a78bfa (top-left → bottom-right)
const R1 = [91,  124, 247]; // #5b7cf7
const R2 = [167, 139, 250]; // #a78bfa

for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
        const alpha = roundRectAlpha(px, py, PAD, PAD, SIZE - 2*PAD, SIZE - 2*PAD, RAD);
        if (alpha <= 0) continue;

        // Gradient theo đường chéo top-left → bottom-right
        const t = Math.min(1, Math.max(0, (px - PAD + py - PAD) / (SIZE - 2*PAD + SIZE - 2*PAD)));
        const r = Math.round(R1[0] + (R2[0] - R1[0]) * t);
        const g = Math.round(R1[1] + (R2[1] - R1[1]) * t);
        const b = Math.round(R1[2] + (R2[2] - R1[2]) * t);
        setPixel(px, py, r, g, b, Math.round(alpha * 255));
    }
}

// 2. Lớp tối nhẹ ở dưới để tạo chiều sâu
for (let py = SIZE / 2; py < SIZE - PAD; py++) {
    for (let px = PAD; px < SIZE - PAD; px++) {
        const alpha = roundRectAlpha(px, py, PAD, PAD, SIZE - 2*PAD, SIZE - 2*PAD, RAD);
        if (alpha <= 0) continue;
        const t = (py - SIZE / 2) / (SIZE / 2 - PAD) * 0.15; // tối tối đa 15%
        const i = (py * SIZE + px) * 4;
        rgba[i]   = Math.round(rgba[i]   * (1 - t));
        rgba[i+1] = Math.round(rgba[i+1] * (1 - t));
        rgba[i+2] = Math.round(rgba[i+2] * (1 - t));
    }
}

// 3. Chữ "W" trắng — nét dày 20px
const T = 20;
const W = 255;
//   TL(66,76) → BL(96,176) → MID(128,136) → BR(160,176) → TR(190,76)
drawLine( 66,  76,  96, 176, T, W, W, W);
drawLine( 96, 176, 128, 136, T, W, W, W);
drawLine(128, 136, 160, 176, T, W, W, W);
drawLine(160, 176, 190,  76, T, W, W, W);

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
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 6; // RGBA
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + width * 4)] = 0;
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
fs.writeFileSync(path.join(outDir, "icon.png"), pngData);
console.log("✓ assets/icon.png");

const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2); // ICO
icoHeader.writeUInt16LE(1, 4); // 1 image

const dirEntry = Buffer.alloc(16);
dirEntry[0] = 0; dirEntry[1] = 0; dirEntry[2] = 0; dirEntry[3] = 0;
dirEntry.writeUInt16LE(1,  4);
dirEntry.writeUInt16LE(32, 6);
dirEntry.writeUInt32LE(pngData.length, 8);
dirEntry.writeUInt32LE(22, 12);

fs.writeFileSync(path.join(outDir, "icon.ico"), Buffer.concat([icoHeader, dirEntry, pngData]));
console.log("✓ assets/icon.ico");
console.log("\nXong! Chạy 'npm run electron' để thử app.");
