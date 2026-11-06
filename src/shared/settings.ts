import { preferenceDefaults as DEFAULTS } from '../../Info.json';

// Users edit these in IINA under Settings, Plugins, Trim, Preferences (pref.html).
// Their defaults live only in Info.json, where IINA requires them.
// check-package.mjs fails the build when the two files disagree.

const CONTAINERS = ['mov', 'mp4', 'mkv'] as const;
export type Container = (typeof CONTAINERS)[number];

export interface Settings {
  clipSuffix: string;
  duplicateSeparator: string;
  reencodeContainer: Container;
  shortcuts: { open: string; setIn: string; setOut: string };
  videotoolboxQuality: number;
  x264Crf: number;
  thumbnailMinWidth: number;
  thumbnailMaxWidth: number;
  thumbnailJpegQuality: number;
  jogWindows: readonly [number, number];
}

type Read = (key: string) => unknown;

const isFileNameText = (value: string): boolean => /^[^/\\:\0]*$/.test(value);
const isKeyBinding = (value: string): boolean =>
  /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:[A-Za-z0-9]+|[^\s+])$/.test(value);

function text(read: Read, key: string, fallback: string, isValid: (v: string) => boolean): string {
  const value = read(key);
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return isValid(trimmed) ? trimmed : fallback;
}

// Number fields arrive as strings from the settings page. Blank means the default.
function whole(read: Read, key: string, fallback: number, min: number, max: number): number {
  const raw = read(key);
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  const chosen = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(chosen)));
}

// Reads every setting, replacing anything unusable with a safe value.
export function readSettings(read: Read): Settings {
  const minWidth = whole(read, 'thumbnail_min_width', DEFAULTS.thumbnail_min_width, 100, 640);
  const firstWindow = whole(read, 'jog_window_first', DEFAULTS.jog_window_first, 1, 3_600);
  const container = CONTAINERS.find((option) => option === read('reencode_container'));

  return {
    clipSuffix: text(read, 'clip_suffix', DEFAULTS.clip_suffix, isFileNameText),
    duplicateSeparator: text(
      read,
      'duplicate_separator',
      DEFAULTS.duplicate_separator,
      isFileNameText,
    ),
    reencodeContainer: container ?? (DEFAULTS.reencode_container as Container),
    shortcuts: {
      open: text(read, 'shortcut_open', DEFAULTS.shortcut_open, isKeyBinding),
      setIn: text(read, 'shortcut_set_in', DEFAULTS.shortcut_set_in, isKeyBinding),
      setOut: text(read, 'shortcut_set_out', DEFAULTS.shortcut_set_out, isKeyBinding),
    },
    videotoolboxQuality: whole(read, 'videotoolbox_quality', DEFAULTS.videotoolbox_quality, 1, 100),
    x264Crf: whole(read, 'x264_crf', DEFAULTS.x264_crf, 0, 51),
    thumbnailMinWidth: minWidth,
    thumbnailMaxWidth: whole(read, 'thumbnail_max_width', DEFAULTS.thumbnail_max_width, minWidth, 640),
    thumbnailJpegQuality: whole(read, 'thumbnail_jpeg_quality', DEFAULTS.thumbnail_jpeg_quality, 2, 31),
    jogWindows: [
      firstWindow,
      whole(read, 'jog_window_wide', DEFAULTS.jog_window_wide, firstWindow, 3_600),
    ],
  };
}

export const DEFAULT_SETTINGS = readSettings(() => undefined);

const KEY_SYMBOLS: Record<string, string> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};

// Alt+Shift+i becomes the Mac symbols for Option, Shift and I.
export function keyLabel(binding: string): string {
  return binding
    .split('+')
    .map((part) => KEY_SYMBOLS[part] ?? part.toUpperCase())
    .join('');
}
