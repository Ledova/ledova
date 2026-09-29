import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const signature = '89504e470d0a1a0a';
const channelsByColourType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
export const band = { top: 0.1, bottom: 0.9 };
export const minimumContent = 0.0005;

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

export function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), signature, 'The screenshot is not a PNG file.');
  let header;
  let palette;
  const data = [];
  for (let offset = 8; offset + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colourType: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  assert.ok(header, 'The PNG has no IHDR chunk.');
  const { width, height, depth, colourType, interlace } = header;
  const channels = channelsByColourType[colourType];
  assert.ok(
    channels && interlace === 0 && (depth === 8 || (depth === 16 && colourType !== 3)),
    `Unsupported PNG layout: colour type ${colourType}, ${depth}-bit, interlace ${interlace}.`,
  );
  assert.ok(colourType !== 3 || palette, 'The palette PNG has no PLTE chunk.');
  const bytesPerPixel = (channels * depth) / 8;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(data));
  assert.equal(raw.length, height * (stride + 1), 'The PNG image data does not match its header.');
  const samples = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, `Unknown PNG filter ${filter} on row ${y}.`);
    const input = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? samples[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? samples[row - stride + x] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        predictor = paeth(left, up, x >= bytesPerPixel && y > 0 ? samples[row - stride + x - bytesPerPixel] : 0);
      }
      samples[row + x] = (raw[input + x] + predictor) & 0xff;
    }
  }
  const step = depth / 8;
  const pixels = new Uint32Array(width * height);
  for (let pixel = 0; pixel < pixels.length; pixel++) {
    const at = pixel * bytesPerPixel;
    if (colourType === 3) {
      const entry = samples[at] * 3;
      pixels[pixel] = (palette[entry] << 16) | (palette[entry + 1] << 8) | palette[entry + 2];
    } else if (colourType === 0 || colourType === 4) {
      const grey = samples[at];
      pixels[pixel] = (grey << 16) | (grey << 8) | grey;
    } else {
      pixels[pixel] = (samples[at] << 16) | (samples[at + step] << 8) | samples[at + 2 * step];
    }
  }
  return { width, height, pixels };
}

export function screenContent({ width, height, pixels }, rows = band) {
  const top = Math.round(height * rows.top);
  const bottom = Math.round(height * rows.bottom);
  const counts = new Map();
  for (let index = top * width; index < bottom * width; index++) {
    counts.set(pixels[index], (counts.get(pixels[index]) ?? 0) + 1);
  }
  let dominant = 0;
  let dominantCount = 0;
  for (const [colour, count] of counts) {
    if (count > dominantCount) [dominant, dominantCount] = [colour, count];
  }
  const total = (bottom - top) * width;
  return {
    width,
    height,
    rows: [top, bottom],
    colours: counts.size,
    dominant: `#${dominant.toString(16).padStart(6, '0')}`,
    content: total ? (total - dominantCount) / total : 0,
  };
}

export function hasContent(metrics) {
  return metrics.content >= minimumContent;
}

export async function waitForContent(capture, file, { attempts = 20, interval = 1000, consecutive = 2 } = {}) {
  let metrics;
  let streak = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await capture();
    metrics = { ...screenContent(decodePng(fs.readFileSync(file))), attempt };
    streak = hasContent(metrics) ? streak + 1 : 0;
    if (streak === consecutive) return metrics;
    if (attempt < attempts) await delay(interval);
  }
  throw new Error(
    `${path.basename(file)} did not show content on ${consecutive} screenshots in a row within ${attempts}: in the last, ${(metrics.content * 100).toFixed(3)}% of rows ${metrics.rows.join('-')} differ from ${metrics.dominant}.`,
  );
}
