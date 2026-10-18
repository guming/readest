import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import nested from 'postcss-nested';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const pdfjsRoot = path.join(repoRoot, 'packages/foliate-js/node_modules/pdfjs-dist');
const vendorRoot = path.join(appRoot, 'public/vendor/pdfjs');

await mkdir(vendorRoot, { recursive: true });

for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'pdf.d.mts']) {
  await cp(path.join(pdfjsRoot, 'legacy/build', file), path.join(vendorRoot, file));
}

for (const directory of ['wasm', 'cmaps', 'standard_fonts']) {
  const target = path.join(vendorRoot, directory);
  await rm(target, { recursive: true, force: true });
  await cp(path.join(pdfjsRoot, directory), target, { recursive: true });
}

const cssRoot = path.join(repoRoot, 'packages/foliate-js/vendor/pdfjs');
for (const file of ['annotation_layer_builder.css', 'text_layer_builder.css']) {
  const source = path.join(cssRoot, file);
  const css = await readFile(source, 'utf8');
  const result = await postcss([nested]).process(css, { from: source, map: false });
  await writeFile(path.join(vendorRoot, file), result.css);
}
