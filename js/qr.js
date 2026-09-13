/*!
 * PentaxQR — a small, dependency-free QR Code encoder.
 * Byte mode, error-correction levels L/M/Q/H, versions 1–40, automatic mask
 * selection. Follows ISO/IEC 18004; the structure borrows from Project
 * Nayuki's QR-Code-generator and node-qrcode (both MIT). The output is a
 * module matrix plus SVG helpers, so no <img> or data: URLs are needed —
 * which keeps the site's `img-src 'self'` CSP intact.
 *
 * Works as a classic browser script (window.PentaxQR) and in Node
 * (globalThis.PentaxQR / module.exports) so tests can exercise it directly.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.PentaxQR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Tables (ISO/IEC 18004 table 9): per version, total codewords, then   */
  /* per level (L, M, Q, H) the number of blocks and EC codewords.        */
  /* ------------------------------------------------------------------ */

  var TOTAL_CODEWORDS = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
    1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196,
    3362, 3532, 3706,
  ];

  var EC_BLOCKS = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4, 2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6, 2, 5, 8, 8,
    4, 5, 8, 8, 4, 5, 8, 11, 4, 8, 10, 11, 4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18, 6, 10, 17, 16, 6, 11, 16, 19,
    6, 13, 18, 21, 7, 14, 21, 25, 8, 16, 20, 25, 8, 17, 23, 25, 9, 17, 23, 34, 9, 18, 25, 30, 10, 20, 27, 32,
    12, 21, 29, 35, 12, 23, 34, 37, 12, 25, 34, 40, 13, 26, 35, 42, 14, 28, 38, 45, 15, 29, 40, 48, 16, 31, 43, 51,
    17, 33, 45, 54, 18, 35, 48, 57, 19, 37, 51, 60, 19, 38, 53, 63, 20, 40, 56, 66, 21, 43, 59, 70, 22, 45, 62, 74,
    24, 47, 65, 77, 25, 49, 68, 81,
  ];

  var EC_CODEWORDS = [
    7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64, 26, 48, 72, 88, 36, 64, 96, 112, 40, 72, 108, 130,
    48, 88, 132, 156, 60, 110, 160, 192, 72, 130, 192, 224, 80, 150, 224, 264, 96, 176, 260, 308, 104, 198, 288, 352,
    120, 216, 320, 384, 132, 240, 360, 432, 144, 280, 408, 480, 168, 308, 448, 532, 180, 338, 504, 588,
    196, 364, 546, 650, 224, 416, 600, 700, 224, 442, 644, 750, 252, 476, 690, 816, 270, 504, 750, 900,
    300, 560, 810, 960, 312, 588, 870, 1050, 336, 644, 952, 1110, 360, 700, 1020, 1200, 390, 728, 1050, 1260,
    420, 784, 1140, 1350, 450, 812, 1200, 1440, 480, 868, 1290, 1530, 510, 924, 1350, 1620, 540, 980, 1440, 1710,
    570, 1036, 1530, 1800, 570, 1064, 1590, 1890, 600, 1120, 1680, 1980, 630, 1204, 1770, 2100, 660, 1260, 1860, 2220,
    720, 1316, 1950, 2310, 750, 1372, 2040, 2430,
  ];

  var LEVELS = {
    L: { name: "L", index: 0, bits: 1 },
    M: { name: "M", index: 1, bits: 0 },
    Q: { name: "Q", index: 2, bits: 3 },
    H: { name: "H", index: 3, bits: 2 },
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */

  function getBit(value, index) {
    return ((value >>> index) & 1) === 1;
  }

  function appendBits(bits, value, length) {
    for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  function toBytes(text) {
    var str = String(text);
    if (typeof TextEncoder !== "undefined") return Array.prototype.slice.call(new TextEncoder().encode(str));
    var s = unescape(encodeURIComponent(str));
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function numDataCodewords(version, level) {
    return TOTAL_CODEWORDS[version] - EC_CODEWORDS[(version - 1) * 4 + level.index];
  }

  function charCountBits(version) {
    return version < 10 ? 8 : 16;
  }

  function alignmentPositions(version) {
    if (version === 1) return [];
    var count = Math.floor(version / 7) + 2;
    var size = version * 4 + 17;
    var interval = size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
    var positions = [size - 7];
    for (var i = 1; i < count - 1; i++) positions[i] = positions[i - 1] - interval;
    positions.push(6);
    return positions.reverse();
  }

  /* ------------------------------------------------------------------ */
  /* Reed–Solomon over GF(2^8), reducing polynomial 0x11D                  */
  /* ------------------------------------------------------------------ */

  function gfMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var d = 0; d < degree; d++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 2);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = [];
    for (var i = 0; i < divisor.length; i++) result.push(0);
    for (var b = 0; b < data.length; b++) {
      var factor = data[b] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) result[j] ^= gfMultiply(divisor[j], factor);
    }
    return result;
  }

  function interleave(data, version, level) {
    var numBlocks = EC_BLOCKS[(version - 1) * 4 + level.index];
    var blockEccLen = EC_CODEWORDS[(version - 1) * 4 + level.index] / numBlocks;
    var rawCodewords = TOTAL_CODEWORDS[version];
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var divisor = rsDivisor(blockEccLen);
    var blocks = [];
    var k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + datLen);
      k += datLen;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var col = 0; col < blocks[0].length; col++) {
      for (var row = 0; row < blocks.length; row++) {
        if (col !== shortBlockLen - blockEccLen || row >= numShortBlocks) result.push(blocks[row][col]);
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Matrix                                                               */
  /* ------------------------------------------------------------------ */

  function Matrix(version, level) {
    this.version = version;
    this.level = level;
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
  }

  Matrix.prototype.set = function (x, y, dark) {
    var idx = y * this.size + x;
    this.modules[idx] = dark ? 1 : 0;
    this.isFunction[idx] = 1;
  };

  Matrix.prototype.drawFunctionPatterns = function () {
    var size = this.size;
    for (var i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    var pos = alignmentPositions(this.version);
    var n = pos.length;
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
        this.drawAlignment(pos[a], pos[b]);
      }
    }
    this.drawFormatBits(0); // reserves the format areas; real bits drawn after masking
    this.drawVersion();
  };

  Matrix.prototype.drawFinder = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx;
        var yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };

  Matrix.prototype.drawAlignment = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };

  Matrix.prototype.drawFormatBits = function (mask) {
    var data = (this.level.bits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var size = this.size;
    for (var a = 0; a <= 5; a++) this.set(8, a, getBit(bits, a));
    this.set(8, 7, getBit(bits, 6));
    this.set(8, 8, getBit(bits, 7));
    this.set(7, 8, getBit(bits, 8));
    for (var b = 9; b < 15; b++) this.set(14 - b, 8, getBit(bits, b));
    for (var c = 0; c < 8; c++) this.set(size - 1 - c, 8, getBit(bits, c));
    for (var d = 8; d < 15; d++) this.set(8, size - 15 + d, getBit(bits, d));
    this.set(8, size - 8, true);
  };

  Matrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (var j = 0; j < 18; j++) {
      var bit = getBit(bits, j);
      var a = this.size - 11 + (j % 3);
      var b = Math.floor(j / 3);
      this.set(a, b, bit);
      this.set(b, a, bit);
    }
  };

  Matrix.prototype.drawCodewords = function (data) {
    var size = this.size;
    var i = 0;
    var total = data.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          var idx = y * size + x;
          if (!this.isFunction[idx] && i < total) {
            this.modules[idx] = getBit(data[i >>> 3], 7 - (i & 7)) ? 1 : 0;
            i++;
          }
        }
      }
    }
  };

  Matrix.prototype.applyMask = function (mask) {
    var size = this.size;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var idx = y * size + x;
        if (this.isFunction[idx]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[idx] ^= 1;
      }
    }
  };

  // Penalty score for mask selection (ISO 18004 §7.8.3, same accounting as node-qrcode).
  Matrix.prototype.penalty = function () {
    var size = this.size;
    var m = this.modules;
    var points = 0;
    for (var row = 0; row < size; row++) {
      var sameCol = 0, sameRow = 0, lastCol = -1, lastRow = -1;
      for (var col = 0; col < size; col++) {
        var v = m[row * size + col];
        if (v === lastCol) sameCol++;
        else {
          if (sameCol >= 5) points += 3 + (sameCol - 5);
          lastCol = v;
          sameCol = 1;
        }
        var w = m[col * size + row];
        if (w === lastRow) sameRow++;
        else {
          if (sameRow >= 5) points += 3 + (sameRow - 5);
          lastRow = w;
          sameRow = 1;
        }
      }
      if (sameCol >= 5) points += 3 + (sameCol - 5);
      if (sameRow >= 5) points += 3 + (sameRow - 5);
    }
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var sum = m[r * size + c] + m[r * size + c + 1] + m[(r + 1) * size + c] + m[(r + 1) * size + c + 1];
        if (sum === 4 || sum === 0) points += 3;
      }
    }
    for (var r2 = 0; r2 < size; r2++) {
      var bitsCol = 0, bitsRow = 0;
      for (var c2 = 0; c2 < size; c2++) {
        bitsCol = ((bitsCol << 1) & 0x7ff) | m[r2 * size + c2];
        if (c2 >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) points += 40;
        bitsRow = ((bitsRow << 1) & 0x7ff) | m[c2 * size + r2];
        if (c2 >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) points += 40;
      }
    }
    var dark = 0;
    for (var i = 0; i < m.length; i++) dark += m[i];
    var k = Math.abs(Math.ceil((dark * 100) / m.length / 5) - 10);
    return points + k * 10;
  };

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * encode(text, { ecc: "M", minVersion: 1, maxVersion: 40, mask: auto })
   * → { version, size, mask, ecc, modules: Uint8Array, get(x, y) }
   */
  function encode(text, options) {
    options = options || {};
    var level = LEVELS[String(options.ecc || "M").toUpperCase()] || LEVELS.M;
    var bytes = toBytes(text);
    var minVersion = Math.max(1, options.minVersion || 1);
    var maxVersion = Math.min(40, options.maxVersion || 40);
    var version = -1;
    for (var v = minVersion; v <= maxVersion; v++) {
      if (4 + charCountBits(v) + bytes.length * 8 <= numDataCodewords(v, level) * 8) {
        version = v;
        break;
      }
    }
    if (version < 0) throw new Error("PentaxQR: the text is too long for a QR Code at this error-correction level.");

    var bits = [];
    appendBits(bits, 4, 4); // byte mode
    appendBits(bits, bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) appendBits(bits, bytes[i], 8);
    var capacity = numDataCodewords(version, level) * 8;
    appendBits(bits, 0, Math.min(4, capacity - bits.length));
    appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      data.push(byte);
    }

    var matrix = new Matrix(version, level);
    matrix.drawFunctionPatterns();
    matrix.drawCodewords(interleave(data, version, level));

    var mask = options.mask;
    if (!(typeof mask === "number" && mask >= 0 && mask <= 7)) {
      var best = 0;
      var bestPenalty = Infinity;
      for (var candidate = 0; candidate < 8; candidate++) {
        matrix.applyMask(candidate);
        matrix.drawFormatBits(candidate);
        var penalty = matrix.penalty();
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          best = candidate;
        }
        matrix.applyMask(candidate); // undo (XOR is its own inverse)
      }
      mask = best;
    }
    matrix.applyMask(mask);
    matrix.drawFormatBits(mask);

    var size = matrix.size;
    var modules = matrix.modules;
    return {
      version: version,
      size: size,
      mask: mask,
      ecc: level.name,
      modules: modules,
      get: function (x, y) {
        return x >= 0 && y >= 0 && x < size && y < size && modules[y * size + x] === 1;
      },
    };
  }

  /** One SVG path covering every dark module (runs merged per row). */
  function svgPath(qr, margin) {
    margin = margin || 0;
    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      var x = 0;
      while (x < qr.size) {
        if (!qr.get(x, y)) {
          x++;
          continue;
        }
        var start = x;
        while (x < qr.size && qr.get(x, y)) x++;
        parts.push("M" + (start + margin) + " " + (y + margin) + "h" + (x - start) + "v1h-" + (x - start) + "z");
      }
    }
    return parts.join("");
  }

  function toSvgString(qr, options) {
    options = options || {};
    var margin = options.margin == null ? 4 : options.margin;
    var dim = qr.size + margin * 2;
    var dark = options.dark || "#000000";
    var light = options.light || "#ffffff";
    var sizeAttr = options.width ? ' width="' + options.width + '" height="' + options.width + '"' : "";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" shape-rendering="crispEdges"' +
      sizeAttr + ' role="img" aria-label="' + (options.label || "QR code") + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path d="' + svgPath(qr, margin) + '" fill="' + dark + '"/></svg>'
    );
  }

  /** Browser only: builds the SVG with DOM APIs (no innerHTML). */
  function toSvgElement(qr, options) {
    options = options || {};
    var NS = "http://www.w3.org/2000/svg";
    var margin = options.margin == null ? 4 : options.margin;
    var dim = qr.size + margin * 2;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + dim + " " + dim);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", options.label || "QR code");
    var rect = document.createElementNS(NS, "rect");
    rect.setAttribute("width", String(dim));
    rect.setAttribute("height", String(dim));
    rect.setAttribute("fill", options.light || "#ffffff");
    svg.appendChild(rect);
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", svgPath(qr, margin));
    path.setAttribute("fill", options.dark || "#000000");
    svg.appendChild(path);
    return svg;
  }

  return { encode: encode, svgPath: svgPath, toSvgString: toSvgString, toSvgElement: toSvgElement };
});
