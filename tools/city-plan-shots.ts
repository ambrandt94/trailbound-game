/**
 * Write the city-plan debug rasters used in the C0 pull request.
 * Run: npx vite-node tools/city-plan-shots.ts
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cityPlan, type SettlementClass } from '../src/core/world/city-plan';
import { paintCityPlan } from '../src/ui/city-plan-paint';

const shots: Array<{ cls: SettlementClass; seed: number; name: string }> = [
  { cls: 'town', seed: 7, name: 'city-plan-town' },
  { cls: 'city', seed: 7, name: 'city-plan-city' },
  { cls: 'metropolis', seed: 7, name: 'city-plan-metropolis' },
];

const dir = '/opt/cursor/artifacts';
mkdirSync(dir, { recursive: true });

for (const shot of shots) {
  const plan = cityPlan(shot.seed, shot.cls);
  const image = paintCityPlan(plan);
  const file = `${dir}/${shot.name}.png`;
  writeFileSync(file, encodePng(image.width, image.height, image.rgba));
  console.log(
    file,
    plan.wards.length,
    'wards',
    'passes',
    plan.passes,
    'fallback',
    plan.fallback,
    'warnings',
    plan.warnings.length,
  );
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[(stride + 1) * y] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, (stride + 1) * y + 1);
  }
  const compressed = deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr(width, height)),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(width, 0);
  buf.writeUInt32BE(height, 4);
  buf[8] = 8;
  buf[9] = 6;
  return buf;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeInt32BE(crc, 8 + data.length);
  return out;
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc;
}
