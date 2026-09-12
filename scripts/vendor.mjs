// Copies the Tesseract.js runtime and English language data from
// node_modules into vendor/ so the app runs with no CDN and works offline
// once loaded. Run after `npm install`: `npm run vendor`.
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = resolve(root, 'node_modules');
const out = resolve(root, 'vendor');

mkdirSync(resolve(out, 'tesseract'), { recursive: true });
mkdirSync(resolve(out, 'tessdata'), { recursive: true });

const copies = [
  ['tesseract.js/dist/tesseract.esm.min.js', 'tesseract/tesseract.esm.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'tesseract/LICENSE.txt'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/LICENSE', 'tesseract/LICENSE-core.txt'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
];

for (const [from, to] of copies) {
  copyFileSync(resolve(nm, from), resolve(out, to));
  console.log('vendored', to);
}

const tv = JSON.parse(readFileSync(resolve(nm, 'tesseract.js/package.json'), 'utf8')).version;
const cv = JSON.parse(readFileSync(resolve(nm, 'tesseract.js-core/package.json'), 'utf8')).version;
console.log(`tesseract.js ${tv}, tesseract.js-core ${cv}`);
