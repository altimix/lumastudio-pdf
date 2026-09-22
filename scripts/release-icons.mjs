// Regenerate the committed app icons from the code-native SVG. No image service or user seal is used.
import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const source = await loadImage(await readFile(new URL('../build/icon.svg', import.meta.url)));
function png(size) {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(source, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}
await writeFile(new URL('../build/icon.png', import.meta.url), png(512));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(png);
const icoHeader = Buffer.alloc(6 + sizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(sizes.length, 4);
let offset = icoHeader.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  icoHeader[entry] = icoHeader[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(pngs[i].length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += pngs[i].length;
}
await writeFile(new URL('../build/icon.ico', import.meta.url), Buffer.concat([icoHeader, ...pngs]));
const chunks = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, size]) => {
  const image = png(size);
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(image.length + 8, 4);
  return Buffer.concat([header, image]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await writeFile(new URL('../build/icon.icns', import.meta.url), Buffer.concat([icnsHeader, ...chunks]));
console.log('Generated build/icon.png, icon.ico, and icon.icns from icon.svg.');
