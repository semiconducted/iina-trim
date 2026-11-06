// Builds dist/main.js for the plugin runtime and dist/sidebar.html, one
// self-contained page, because IINA opens the sidebar from a file URL.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const shared = { bundle: true, format: 'iife', target: 'safari15', legalComments: 'none' };
function fingerprint(text) {
  const digest = createHash('sha256').update(text).digest('base64');
  return "'sha256-" + digest + "'";
}

await rm('dist', { force: true, recursive: true });
await mkdir('dist');

await build({ ...shared, entryPoints: ['src/plugin/main.ts'], outfile: 'dist/main.js' });

const bundle = await build({
  ...shared,
  entryPoints: ['src/sidebar/sidebar.ts'],
  minify: true,
  write: false,
});
// A closing tag inside the bundle would end the inline script early.
const script = bundle.outputFiles[0].text.split('</script').join('<\\/script');
const style = await readFile('src/sidebar/sidebar.css', 'utf8');
const csp = [
  "default-src 'none'",
  `script-src ${fingerprint(script)}`,
  `style-src ${fingerprint(style)}`,
  'img-src data:',
].join('; ');

const template = await readFile('src/sidebar/template.html', 'utf8');
await writeFile(
  'dist/sidebar.html',
  template
    .replace('__CSP__', () => csp)
    .replace('__STYLE__', () => style)
    .replace('__SCRIPT__', () => script),
);
