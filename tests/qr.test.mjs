// js/qr.js regression tests. The reference vectors were produced by this
// encoder and checked bit for bit against node-qrcode 1.5.4 (360/360 matrices
// identical across texts × ECC levels × masks) and decoded with OpenCV 5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

await import("../js/qr.js");
const QR = globalThis.PentaxQR;
const sha = (qr) => createHash("sha256").update(Buffer.from(qr.modules)).digest("hex");

const VECTORS = [
  {
    text: "https://www.pentaxloupes.co.uk/p/0123456789abcdef0123456789abcdef",
    ecc: "M",
    version: 5,
    size: 37,
    mask: 2,
    sha: "1065a6de75ceb37fe73e53afa8dea3df328da326c2c0fddcf2097276aa794cee",
  },
  {
    text: "https://www.pentaxloupes.co.uk/invite/fedcba9876543210fedcba9876543210",
    ecc: "Q",
    version: 6,
    size: 41,
    mask: 6,
    sha: "05904df150cfe4a241dbaa4a5be783c0b0aa85e8b139aca9768d10805cfa8e07",
  },
  {
    text: "PENTAX Loupes UK",
    ecc: "L",
    version: 1,
    size: 21,
    mask: 3,
    sha: "f691e266da8302764192b0f431c576b503a280e0c52b224213cc1825f9f97a15",
  },
];

test("matches the reference vectors", () => {
  for (const v of VECTORS) {
    const qr = QR.encode(v.text, { ecc: v.ecc });
    assert.equal(qr.version, v.version, v.text);
    assert.equal(qr.size, v.size, v.text);
    assert.equal(qr.mask, v.mask, v.text);
    assert.equal(sha(qr), v.sha, v.text);
  }
});

test("draws the fixed patterns every scanner looks for", () => {
  const qr = QR.encode("https://www.pentaxloupes.co.uk/p/example");
  assert.equal(qr.size, qr.version * 4 + 17);
  // Finder pattern corners and centres
  for (const [x, y] of [[0, 0], [3, 3], [6, 6], [qr.size - 1, 0], [qr.size - 4, 3], [0, qr.size - 1], [3, qr.size - 4]]) {
    assert.equal(qr.get(x, y), true, `finder module at ${x},${y}`);
  }
  // Separators are light
  assert.equal(qr.get(7, 7), false);
  assert.equal(qr.get(qr.size - 8, 7), false);
  assert.equal(qr.get(7, qr.size - 8), false);
  // Timing patterns alternate
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.get(i, 6), i % 2 === 0, `timing row at ${i}`);
    assert.equal(qr.get(6, i), i % 2 === 0, `timing column at ${i}`);
  }
  // Dark module beside the bottom-left finder
  assert.equal(qr.get(8, qr.size - 8), true);
});

test("a forced mask is honoured and every mask stays scannable in shape", () => {
  for (let mask = 0; mask < 8; mask++) {
    const qr = QR.encode("PENTAX", { mask });
    assert.equal(qr.mask, mask);
    assert.equal(qr.get(0, 0), true);
    assert.equal(qr.get(8, qr.size - 8), true);
  }
});

test("renders SVG with a quiet zone and a single path", () => {
  const qr = QR.encode("hi");
  const svg = QR.toSvgString(qr, { width: 128, dark: "#111", light: "#fafafa" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29"/);
  assert.match(svg, /width="128" height="128"/);
  assert.match(svg, /<rect width="29" height="29" fill="#fafafa"\/>/);
  assert.match(svg, /<path d="M4 4h7v1h-7z/); // first finder row, offset by the 4-module margin
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.equal(QR.svgPath(qr, 0).startsWith("M0 0h7v1h-7z"), true);
});

test("encodes UTF-8 and refuses text that cannot fit", () => {
  const qr = QR.encode("PENTAX Loupes UK — précision ✓");
  assert.ok(qr.version >= 2);
  assert.throws(() => QR.encode("x".repeat(3000), { ecc: "H" }), /too long/);
  assert.equal(QR.encode("y".repeat(2900), { ecc: "L" }).version, 40);
});
