import { describe, expect, it } from 'vitest';
import {
  clipName,
  extensionOf,
  folderOf,
  freeClipName,
  isLocalFile,
  isPlainFileName,
  joinPath,
} from '../src/plugin/paths';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const settings = {
  ...DEFAULT_SETTINGS,
  clipSuffix: '.cut',
  duplicateSeparator: '~',
  reencodeContainer: 'mkv' as const,
};

describe('path helpers', () => {
  it('splits and joins folders', () => {
    expect(folderOf('/Movies/a.mkv')).toBe('/Movies');
    expect(folderOf('/a.mkv')).toBe('/');
    expect(folderOf('a.mkv')).toBe('');
    expect(joinPath('/Movies', 'a.mkv')).toBe('/Movies/a.mkv');
    expect(joinPath('/', 'a.mkv')).toBe('/a.mkv');
    expect(joinPath('', 'a.mkv')).toBe('a.mkv');
  });

  it('finds extensions in lowercase, ignoring hidden names', () => {
    expect(extensionOf('a.b.MKV')).toBe('mkv');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('plain')).toBe('');
  });

  it('accepts local files and rejects streams', () => {
    expect(isLocalFile('/Movies/a.mp4')).toBe(true);
    expect(isLocalFile('https://example.com/a.mp4')).toBe(false);
    expect(isLocalFile('')).toBe(false);
  });

  it('accepts plain file names only', () => {
    expect(isPlainFileName('my clip.mkv')).toBe(true);
    for (const name of ['', '.hidden', '../x.mkv', 'a/b.mkv', 'a:b.mkv', 'a\\b.mkv', ' padded.mkv', 'x'.repeat(256)]) {
      expect(isPlainFileName(name)).toBe(false);
    }
  });
});

describe('clip names', () => {
  it('keeps the source format for a lossless clip', () => {
    expect(clipName('a.b.mp4', true, settings)).toBe('a.b.cut.mp4');
  });

  it('uses the chosen format for a re-encode, or when the source has none', () => {
    expect(clipName('a.mp4', false, settings)).toBe('a.cut.mkv');
    expect(clipName('a', true, settings)).toBe('a.cut.mkv');
  });

  it('numbers a clip when the name is taken', () => {
    const taken = new Set(['/M/a.cut.mp4', '/M/a.cut~2.mp4']);
    expect(freeClipName('/M', 'a.mp4', true, (path) => taken.has(path), settings)).toBe('a.cut~3.mp4');
    expect(freeClipName('/N', 'a.mp4', true, (path) => taken.has(path), settings)).toBe('a.cut.mp4');
  });
});
