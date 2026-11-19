import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
// Plain JS art tools, checked by this test rather than by tsc.
// @ts-expect-error untyped mjs module.
import { sliceSheet } from '../../tools/hud-day-cycle-slice.mjs';
// @ts-expect-error untyped mjs module.
import { buildTemplate } from '../../tools/hud-day-cycle-template.mjs';
// @ts-expect-error untyped mjs module.
import { createImage, decodePng, encodePng } from '../../tools/ui-png.mjs';

interface Img {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  px(x: number, y: number, c: number[]): void;
  get(x: number, y: number): number[];
}
interface Cell {
  rect: { x: number; y: number; w: number; h: number };
  rect1x: { x: number; y: number; w: number; h: number };
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Layout {
  scale: number;
  sheet: { w: number; h: number };
  native: { w: number; h: number };
  gutter: number;
  preview: { rect: Rect; rect1x: Rect };
  slots: Array<{ id: string; file: string; cells: Cell[] }>;
  font: {
    glyphs: string;
    cellW: number;
    pitch: number;
    gap: number;
    widths: Record<string, number>;
    cells: Array<{ glyph: string; index: number; rect: Rect; rect1x: Rect }>;
  };
}

const art = join(process.cwd(), 'public', 'assets', 'ui', 'hud-day-cycle');
const read = (file: string): Img => decodePng(readFileSync(join(art, file)));
const layout = JSON.parse(readFileSync(join(art, 'template', 'layout.json'), 'utf8')) as Layout;
const sheet512 = read('template/hud-day-cycle-template-512.png');
const sheet1x = read('template/hud-day-cycle-template-1x.png');

function expectSame(files: Array<{ file: string; image: Img }>): void {
  expect(files.length).toBe(layout.slots.length + 1);
  for (const { file, image } of files) {
    const want = read(file);
    expect({ file, w: image.w, h: image.h }).toEqual({ file, w: want.w, h: want.h });
    expect(Buffer.from(image.data).equals(Buffer.from(want.data)), file).toBe(true);
  }
}

describe('hud day-cycle template round trip', () => {
  test('slicing the unedited 512 sheet gives back the placeholders, pixel for pixel', () => {
    expect(sheet512.w).toBe(512);
    expect(sheet512.h).toBe(512);
    expectSame(sliceSheet(sheet512, layout));
  });

  test('slicing the native 1x sheet does too', () => {
    expect(sheet1x.w).toBe(layout.native.w);
    expectSame(sliceSheet(sheet1x, layout));
  });

  test('a 1024 export of the sheet (2x the pixels) slices the same', () => {
    const big = createImage(1024, 1024) as Img;
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 1024; x++) big.px(x, y, sheet512.get(x >> 1, y >> 1));
    expectSame(sliceSheet(big, layout));
  });

  test('off-grid noise inside each block does not change the result', () => {
    const noisy = createImage(512, 512) as Img;
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) noisy.px(x, y, sheet512.get(x, y));
    const s = layout.scale;
    for (let by = 0; by + s <= 512; by += s) {
      for (let bx = 0; bx + s <= 512; bx += s) {
        // Two stray pixels per block, a colour of their own, well under half the block.
        for (let i = 0; i < 2; i++) {
          noisy.px(bx + Math.floor(rnd() * s), by + Math.floor(rnd() * s), [
            Math.floor(rnd() * 256),
            Math.floor(rnd() * 256),
            Math.floor(rnd() * 256),
            rnd() < 0.5 ? 255 : 3,
          ]);
        }
      }
    }
    expectSame(sliceSheet(noisy, layout));
  });

  test('a sheet of the wrong size is refused with the sizes that work', () => {
    const odd = createImage(300, 300);
    expect(() => sliceSheet(odd, layout)).toThrow(/expected/);
  });

  test('cells stay on the sheet, on the pixel grid, and keep a gutter apart', () => {
    const rects = [
      ...layout.slots.flatMap((s) => s.cells),
      ...layout.font.cells,
      { rect: layout.preview.rect },
    ].map((c) => c.rect);
    expect(rects.length).toBeGreaterThan(60);
    for (const r of rects) {
      expect(r.x % layout.scale).toBe(0);
      expect(r.y % layout.scale).toBe(0);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(512);
      expect(r.y + r.h).toBeLessThanOrEqual(512);
    }
    const gap = layout.gutter * layout.scale;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        const apartX = a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x;
        const apartY = a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y;
        expect(apartX || apartY, `${i} vs ${j}`).toBe(true);
      }
    }
  });
});

describe('hud day-cycle template v2: spaced font, sample band, 512 sheet', () => {
  const alpha = (img: Img, x: number, y: number): number => img.get(x, y)[3] ?? 0;
  const font = layout.font;

  test('the sheet is 512x512 and the guide and 1x sheet match the layout', () => {
    expect(layout.sheet).toEqual({ w: 512, h: 512 });
    expect(read('template/hud-day-cycle-template-guide.png').w).toBe(512);
    expect(read('template/hud-day-cycle-template-guide.png').h).toBe(512);
    expect(sheet1x.w).toBe(Math.floor(512 / layout.scale));
    expect(sheet1x.h).toBe(Math.floor(512 / layout.scale));
  });

  test('every glyph but the blank space has its own cell, as wide as the game advances it', () => {
    const wanted = [...font.glyphs].filter((ch) => ch !== ' ');
    expect(font.cells.map((c) => c.glyph)).toEqual(wanted);
    for (const c of font.cells) {
      expect(c.rect1x.w).toBe(Math.min(font.widths[c.glyph] ?? font.cellW, font.cellW));
      expect(c.rect.w).toBe(c.rect1x.w * layout.scale);
    }
  });

  test('font cells sit on one pitch with clear pixels between neighbours', () => {
    expect(font.gap).toBeGreaterThanOrEqual(1);
    expect(font.pitch).toBe(font.cellW + font.gap);
    const rows = new Map<number, typeof font.cells>();
    for (const c of font.cells) rows.set(c.rect1x.y, [...(rows.get(c.rect1x.y) ?? []), c]);
    expect(rows.size).toBeGreaterThanOrEqual(1);
    for (const row of rows.values()) {
      row.sort((a, b) => a.rect1x.x - b.rect1x.x);
      const x0 = row[0]?.rect1x.x ?? 0;
      row.forEach((c, i) => expect(c.rect1x.x).toBe(x0 + i * font.pitch));
      for (const [a, b] of row.slice(0, -1).map((c, i) => [c, row[i + 1]] as const)) {
        if (!b) continue;
        // Every native pixel column strictly between two cells is fully clear, on both sheets.
        for (let x = a.rect1x.x + a.rect1x.w; x < b.rect1x.x; x++) {
          for (let y = a.rect1x.y; y < a.rect1x.y + a.rect1x.h; y++) {
            expect(alpha(sheet1x, x, y)).toBe(0);
            expect(alpha(sheet512, x * layout.scale + 1, y * layout.scale + 1)).toBe(0);
          }
        }
      }
    }
  });

  test('the sample band is on both sheets, is drawn, and the slicer ignores it', () => {
    const { rect, rect1x } = layout.preview;
    let drawn = 0;
    for (let y = rect1x.y; y < rect1x.y + rect1x.h; y++)
      for (let x = rect1x.x; x < rect1x.x + rect1x.w; x++) if (alpha(sheet1x, x, y) > 0) drawn++;
    expect(drawn).toBeGreaterThan(rect1x.w * 8);
    // Paint over the whole band (and the area around it) on a copy: the result must not change.
    const scribbled = createImage(512, 512) as Img;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) scribbled.px(x, y, sheet512.get(x, y));
    for (let y = rect.y; y < rect.y + rect.h + 3; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++)
        scribbled.px(x, y, [(x * 7) & 255, (y * 13) & 255, 99, 255]);
    expectSame(sliceSheet(scribbled, layout));
  });

  test('gutters between cells can hold anything without changing the result', () => {
    const cells = [
      ...layout.slots.flatMap((s) => s.cells),
      ...layout.font.cells,
      { rect: layout.preview.rect },
    ];
    const inCell = (x: number, y: number): boolean =>
      cells.some(({ rect: r }) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
    const scribbled = createImage(512, 512) as Img;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++)
        scribbled.px(x, y, inCell(x, y) ? sheet512.get(x, y) : [250, 20, 120, 255]);
    expectSame(sliceSheet(scribbled, layout));
  });

  test('the 512 sheet is a pure nearest-neighbour upscale of the 1x sheet', () => {
    const s = layout.scale;
    const edge = layout.native.w * s;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const want =
          x < edge && y < edge ? sheet1x.get(Math.floor(x / s), Math.floor(y / s)) : [0, 0, 0, 0];
        const got = sheet512.get(x, y);
        // Straight alpha: only compare colour where something is drawn.
        if (want[3] === 0) expect(got[3], `${x},${y}`).toBe(0);
        else expect(got, `${x},${y}`).toEqual(want);
      }
    }
  });

  test('the committed template is what the tool builds from the art in the game now', async () => {
    const built = await buildTemplate();
    expect(JSON.parse(JSON.stringify(built.layout))).toEqual(layout);
    expect(Buffer.from(built.sheet.data).equals(Buffer.from(sheet512.data))).toBe(true);
    expect(Buffer.from(built.flat.data).equals(Buffer.from(sheet1x.data))).toBe(true);
    const guide = read('template/hud-day-cycle-template-guide.png');
    expect(Buffer.from(built.guide.data).equals(Buffer.from(guide.data))).toBe(true);
  }, 60_000);
});

describe('png decoding for edited sheets', () => {
  test('reads an RGB png (no alpha) and an indexed png with transparency', () => {
    const png = (
      w: number,
      h: number,
      colorType: number,
      rows: number[][],
      extra: Buffer[] = [],
    ): Buffer => {
      const chunk = (type: string, data: Buffer): Buffer => {
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0);
        out.write(type, 4, 'latin1');
        data.copy(out, 8);
        let c = ~0;
        for (const byte of out.subarray(4, 8 + data.length)) {
          c ^= byte;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        out.writeUInt32BE(~c >>> 0, 8 + data.length);
        return out;
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(h, 4);
      ihdr[8] = 8;
      ihdr[9] = colorType;
      const raw = Buffer.concat(rows.map((r) => Buffer.from([0, ...r])));
      return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        ...extra.map((e, i) => chunk(i === 0 ? 'PLTE' : 'tRNS', e)),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ]);
    };
    const rgb = decodePng(png(2, 1, 2, [[10, 20, 30, 40, 50, 60]])) as Img;
    expect(rgb.get(1, 0)).toEqual([40, 50, 60, 255]);
    const indexed = decodePng(
      png(2, 1, 3, [[0, 1]], [Buffer.from([1, 2, 3, 200, 100, 50]), Buffer.from([0, 255])]),
    ) as Img;
    expect(indexed.get(0, 0)[3]).toBe(0);
    expect(indexed.get(1, 0)).toEqual([200, 100, 50, 255]);
    expect(encodePng(rgb).length).toBeGreaterThan(0);
  });
});
