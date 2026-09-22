import { cp, mkdir } from 'node:fs/promises';
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await mkdir('public/pdfjs', {recursive:true});
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, {recursive:true});
}
