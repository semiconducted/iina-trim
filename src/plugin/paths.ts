import type { Settings } from '../shared/settings';

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return '';
  return slash === 0 ? '/' : path.slice(0, slash);
}

export function joinPath(folder: string, name: string): string {
  if (folder === '') return name;
  return folder.endsWith('/') ? folder + name : `${folder}/${name}`;
}

// Lowercase, without the dot. A leading dot alone does not count as an extension.
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isLocalFile(path: string): boolean {
  return path !== '' && !path.includes('://');
}

// One visible file name: no folders, no hidden files, no stray spaces at the ends.
export function isPlainFileName(name: string): boolean {
  return name !== '' && name === name.trim() && name.length <= 255 && /^[^./\\:\0][^/\\:\0]*$/.test(name);
}

// A lossless clip keeps the source format; a re-encode uses the chosen one.
export function clipName(sourceName: string, lossless: boolean, settings: Settings): string {
  const extension = extensionOf(sourceName);
  const stem = extension === '' ? sourceName : sourceName.slice(0, -(extension.length + 1));
  const format = lossless && extension !== '' ? extension : settings.reencodeContainer;
  return `${stem.trim() || 'clip'}${settings.clipSuffix}.${format}`;
}

// The clip name, numbered when that name is already taken in the folder.
export function freeClipName(
  folder: string,
  sourceName: string,
  lossless: boolean,
  exists: (path: string) => boolean,
  settings: Settings,
): string {
  const name = clipName(sourceName, lossless, settings);
  if (!exists(joinPath(folder, name))) return name;

  const dot = name.lastIndexOf('.');
  for (let number = 2; ; number += 1) {
    const numbered = `${name.slice(0, dot)}${settings.duplicateSeparator}${number}${name.slice(dot)}`;
    if (!exists(joinPath(folder, numbered))) return numbered;
  }
}
