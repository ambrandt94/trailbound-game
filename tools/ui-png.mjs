import { deflateSync, inflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * @param {Buffer} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  type.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** @param {Buffer} buf */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

/**
 * @param {number} w
 * @param {number} h
 */
export function createImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    w,
    h,
    data,
    /** @param {number} x @param {number} y @param {readonly number[]} color */
    px(x, y, color) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    },
    /** @param {number} x @param {number} y */
    get(x, y) {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
  };
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {readonly number[]} color
 */
export function fillRect(img, x, y, w, h, color) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) img.px(x + xx, y + yy, color);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 */
export function encodePng(img) {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    const row = y * (img.w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4;
      const d = row + 1 + x * 4;
      raw[d] = img.data[s];
      raw[d + 1] = img.data[s + 1];
      raw[d + 2] = img.data[s + 2];
      raw[d + 3] = img.data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    SIG,
    chunk(Buffer.from('IHDR'), ihdr),
    chunk(Buffer.from('IDAT'), deflateSync(raw)),
    chunk(Buffer.from('IEND'), Buffer.alloc(0)),
  ]);
  return png;
}

/** @param {Buffer} png */
export function decodePng(png) {
  if (!png.subarray(0, 8).equals(SIG)) throw new Error('not a png');
  let off = 8;
  let w = 0;
  let h = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('png must be 8-bit rgba');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const img = createImage(w, h);
  let p = 0;
  /** @type {Buffer | null} */
  let prev = null;
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    if (filter === 1) {
      for (let i = 4; i < row.length; i++) row[i] = (row[i] + row[i - 4]) & 255;
    } else if (filter === 2 && prev) {
      for (let i = 0; i < row.length; i++) row[i] = (row[i] + prev[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < row.length; i++) {
        const left = i >= 4 ? row[i - 4] : 0;
        const up = prev ? prev[i] : 0;
        row[i] = (row[i] + ((left + up) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < row.length; i++) {
        const a = i >= 4 ? row[i - 4] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= 4 ? prev[i - 4] : 0;
        row[i] = (row[i] + paeth(a, b, c)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported png filter ${filter}`);
    }
    img.data.set(row, y * stride);
    prev = row;
  }
  return img;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
