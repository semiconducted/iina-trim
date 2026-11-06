// Fails the build when the package is incomplete or the settings page and the
// defaults in Info.json have drifted apart.
import { access, readFile } from 'node:fs/promises';

const info = JSON.parse(await readFile('Info.json', 'utf8'));
const problems = [];

for (const file of [info.entry, info.preferencesPage, 'dist/sidebar.html']) {
  await access(file).catch(() => problems.push(`Missing file: ${file}`));
}

const page = await readFile(info.preferencesPage, 'utf8');
const defaults = info.preferenceDefaults;
const fields = new Set([
  ...[...page.matchAll(/data-pref-key="([^"]+)"/g)].map((found) => found[1]),
  ...[...page.matchAll(/type="radio"[^>]*\bname="([^"]+)"/g)].map((found) => found[1]),
]);

for (const [key, value] of Object.entries(defaults)) {
  if (!fields.has(key)) problems.push(`Settings page has no field for ${key}.`);
  if (value === '') continue;
  const shown = new RegExp(`data-default-for="${key}">([^<]*)<`).exec(page)?.[1]?.trim();
  if (shown !== `Default: ${value}`) {
    problems.push(`Settings page shows "${shown}" for ${key}; Info.json says ${value}.`);
  }
}
for (const key of fields) {
  if (!(key in defaults)) problems.push(`Settings page field ${key} has no default in Info.json.`);
}

// Trim must never load code from elsewhere or reach the network.
for (const key of ['ghRepo', 'ghVersion', 'allowedDomains']) {
  if (key in info) problems.push(`Info.json must not contain ${key}.`);
}
if (info.permissions.includes('network-request')) {
  problems.push('Info.json must not request network-request.');
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
