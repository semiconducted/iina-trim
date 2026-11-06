import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, keyLabel, readSettings } from '../src/shared/settings';

const from = (values: Record<string, unknown>) => readSettings((key) => values[key]);

describe('readSettings', () => {
  it('falls back to the defaults when nothing is set', () => {
    expect(from({})).toEqual(DEFAULT_SETTINGS);
  });

  it('reads text and number fields as the settings page stores them', () => {
    const settings = from({
      clip_suffix: ' .cut ',
      duplicate_separator: '~',
      reencode_container: 'mkv',
      shortcut_open: 'Meta+Shift+k',
      x264_crf: '18',
      videotoolbox_quality: 55,
    });

    expect(settings).toMatchObject({
      clipSuffix: '.cut',
      duplicateSeparator: '~',
      reencodeContainer: 'mkv',
      x264Crf: 18,
      videotoolboxQuality: 55,
    });
    expect(settings.shortcuts.open).toBe('Meta+Shift+k');
  });

  it('allows a blank suffix and separator', () => {
    expect(from({ clip_suffix: '', duplicate_separator: '' })).toMatchObject({
      clipSuffix: '',
      duplicateSeparator: '',
    });
  });

  it('replaces unusable values with the defaults', () => {
    const settings = from({
      clip_suffix: 'a/b',
      duplicate_separator: 'a:b',
      reencode_container: 'exe',
      shortcut_set_in: 'Hyper+i',
      shortcut_set_out: '',
      x264_crf: '',
      videotoolbox_quality: 'high',
    });

    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps numbers in range and in order', () => {
    expect(
      from({
        x264_crf: 99,
        videotoolbox_quality: 0,
        thumbnail_jpeg_quality: 1,
        thumbnail_min_width: 400,
        thumbnail_max_width: 200,
        jog_window_first: 60,
        jog_window_wide: 10,
      }),
    ).toMatchObject({
      x264Crf: 51,
      videotoolboxQuality: 1,
      thumbnailJpegQuality: 2,
      thumbnailMinWidth: 400,
      thumbnailMaxWidth: 400,
      jogWindows: [60, 60],
    });
  });
});

describe('keyLabel', () => {
  it('shows key bindings as Mac symbols', () => {
    expect(keyLabel('Alt+Shift+i')).toBe('⌥⇧I');
    expect(keyLabel('Ctrl+Shift+t')).toBe('⌃⇧T');
    expect(keyLabel('Meta+k')).toBe('⌘K');
  });
});
