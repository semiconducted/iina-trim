import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startTrim } from '../src/plugin/trim';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const { clipSuffix, duplicateSeparator } = DEFAULT_SETTINGS;
const SOURCE = '/Movies/demo.mkv';
const range = { inTime: 10, outTime: 20, useHardware: false, crop: false };

type Handler = (data: unknown) => void;

// A stand-in for IINA that records what the plugin does.
function fakeIina(preferences: Record<string, unknown> = {}, hasWindow = true) {
  const handlers = new Map<string, Handler>();
  const events = new Map<string, () => void>();
  const menu = new Map<string, { action: () => void; keyBinding: string }>();
  const files = new Set(['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe', SOURCE]);
  const window = { loaded: hasWindow };

  const exec = vi.fn(
    async (file: string, args: string[], _cwd?: unknown, onOutput?: ((chunk: string) => void) | null) => {
      if (file.endsWith('ffprobe')) return { status: 0, stdout: '90.15\n96.15\n102.16\n', stderr: '' };
      if (args.some((arg) => arg.includes('showinfo'))) {
        files.add(args.at(-1) as string);
        return { status: 0, stdout: '', stderr: 'n: 0 pts: 1 pts_time:96.15' };
      }
      onOutput?.('out_time_us=5000000\nprogress=continue\n');
      return { status: 0, stdout: '', stderr: '' };
    },
  );

  const api = {
    sidebar: {
      // Loading a page drops earlier listeners, as it does in IINA.
      loadFile: vi.fn(() => handlers.clear()),
      onMessage: (name: string, handler: Handler) => handlers.set(name, handler),
      postMessage: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
    },
    menu: {
      item: (title: string, action: () => void, options: { keyBinding: string }) => {
        menu.set(title, { action, keyBinding: options.keyBinding });
        return { title };
      },
      addItem: vi.fn(),
    },
    core: { window, osd: vi.fn(), seekTo: vi.fn(), pause: vi.fn(), resume: vi.fn() },
    event: { on: (name: string, callback: () => void) => events.set(name, callback) },
    mpv: {
      getNumber: vi.fn(() => 12.5),
      getString: (name: string): string => (name === 'path' ? SOURCE : 'demo.mkv'),
    },
    preferences: { get: (key: string) => preferences[key] },
    utils: {
      exec,
      fileInPath: (path: string) => files.has(path),
      resolvePath: (path: string) => path.replace('@tmp', '/tmp/trim'),
      chooseFile: vi.fn(() => '/Users/me/Desktop/'),
    },
    file: {
      handle: () => ({ readToEnd: () => [77], close: vi.fn() }),
      delete: vi.fn((path: string) => files.delete(path)),
    },
    console: { error: vi.fn() },
  };

  return {
    api: api as unknown as IINA.IINAGlobal,
    raw: api,
    exec,
    files,
    menu,
    window,
    events,
    handlers,
    from: (name: string, data: unknown = {}) => handlers.get(name)?.(data),
    sent: (name: string) => api.sidebar.postMessage.mock.calls.filter((call) => call[0] === name).map((call) => call[1]),
  };
}

describe('startup', () => {
  it('waits for the player window before loading the sidebar', () => {
    const iina = fakeIina({}, false);
    startTrim(iina.api);
    expect(iina.raw.sidebar.loadFile).not.toHaveBeenCalled();

    iina.window.loaded = true;
    iina.events.get('iina.window-loaded')?.();
    iina.events.get('iina.window-loaded')?.();
    expect(iina.raw.sidebar.loadFile).toHaveBeenCalledOnce();
    expect(iina.handlers.size).toBe(8);
  });

  it('adds three menu items with the configured shortcuts', () => {
    const iina = fakeIina({ shortcut_set_in: 'Meta+i' });
    startTrim(iina.api);
    expect(iina.menu.get('Open Trim')?.keyBinding).toBe(DEFAULT_SETTINGS.shortcuts.open);
    expect(iina.menu.get('Set Clip In')?.keyBinding).toBe('Meta+i');
    expect(iina.menu.get('Set Clip Out')?.keyBinding).toBe(DEFAULT_SETTINGS.shortcuts.setOut);
  });

  it('does not touch the sidebar from a menu item before the window exists', () => {
    const iina = fakeIina({}, false);
    startTrim(iina.api);
    iina.menu.get('Set Clip In')?.action();
    expect(iina.raw.sidebar.show).not.toHaveBeenCalled();
    expect(iina.sent('markSet')).toEqual([]);
  });
});

describe('sidebar state', () => {
  it('reports the shortcuts actually bound and the current preview widths', () => {
    const preferences: Record<string, unknown> = { shortcut_set_in: 'Meta+i', thumbnail_min_width: 200 };
    const iina = fakeIina(preferences);
    startTrim(iina.api);
    preferences.shortcut_set_in = 'Meta+j';
    preferences.thumbnail_max_width = 300;
    iina.from('sidebarReady');

    expect(iina.sent('sidebarConfig')).toEqual([
      { minWidth: 200, maxWidth: 300, inKey: '⌘I', outKey: '⌥⇧O' },
    ]);
    expect(iina.sent('ffmpegState')).toEqual([{ found: true }]);
  });

  it('replays marks made before the sidebar finished loading', () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.menu.get('Set Clip In')?.action();
    iina.raw.sidebar.postMessage.mockClear();
    iina.from('sidebarReady');
    expect(iina.sent('markSet')).toEqual([{ mark: 'in', time: 12.5 }]);
  });

  it('clears marks when another file opens', () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('markPlayhead', { mark: 'in' });
    iina.events.get('iina.file-loaded')?.();
    iina.raw.sidebar.postMessage.mockClear();
    iina.from('sidebarReady');
    expect(iina.sent('marksCleared')).toEqual([]);
    expect(iina.sent('markSet')).toEqual([]);
  });
});

describe('marks', () => {
  it('rounds a playhead on a keyframe to the correct side', () => {
    const iina = fakeIina();
    iina.raw.mpv.getNumber.mockReturnValue(96.15845);
    startTrim(iina.api);
    iina.from('markPlayhead', { mark: 'in' });
    iina.from('markPlayhead', { mark: 'out' });
    expect(iina.sent('markSet')).toEqual([
      { mark: 'in', time: 96.159 },
      { mark: 'out', time: 96.158 },
    ]);
  });

  it('marks the playhead and ignores bad input', () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('markPlayhead', { mark: 'out' });
    iina.from('markPlayhead', { mark: 'sideways' });
    expect(iina.sent('markSet')).toEqual([{ mark: 'out', time: 12.5 }]);
  });

  it('seeks only to valid times', () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('seek', { time: 83.5 });
    iina.from('seek', { time: -1 });
    iina.from('seek', { time: 'later' });
    expect(iina.raw.core.seekTo.mock.calls).toEqual([[83.5]]);
  });
});

describe('save proposal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('proposes beside the source, numbered if taken, without running anything', () => {
    const iina = fakeIina();
    iina.files.add(`/Movies/demo${clipSuffix}.mkv`);
    startTrim(iina.api);
    iina.from('proposeSave', { crop: false, folder: '' });
    expect(iina.sent('saveProposal')).toEqual([
      { folder: '/Movies', name: `demo${clipSuffix}${duplicateSeparator}2.mkv` },
    ]);
    expect(iina.exec).not.toHaveBeenCalled();
  });

  it('uses a setting changed while running', () => {
    const preferences: Record<string, unknown> = {};
    const iina = fakeIina(preferences);
    startTrim(iina.api);
    preferences.clip_suffix = '.cut';
    iina.from('proposeSave', { crop: false, folder: '' });
    expect(iina.sent('saveProposal')).toEqual([{ folder: '/Movies', name: 'demo.cut.mkv' }]);
  });

  it('proposes for the chosen folder, and nothing if the chooser is cancelled', () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('pickFolder', { crop: false });
    expect(iina.sent('saveProposal')).toEqual([{ folder: '/Users/me/Desktop', name: `demo${clipSuffix}.mkv` }]);

    iina.raw.utils.chooseFile.mockReturnValue('');
    iina.from('pickFolder', { crop: false });
    expect(iina.sent('saveProposal')).toHaveLength(1);
  });

  it('keeps the current folder and uses the re-encode format for a crop', () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('proposeSave', { crop: true, folder: '/Elsewhere' });
    expect(iina.sent('saveProposal')).toEqual([
      { folder: '/Elsewhere', name: `demo${clipSuffix}.${DEFAULT_SETTINGS.reencodeContainer}` },
    ]);
  });

  it('stays quiet when no local video is open', () => {
    const iina = fakeIina();
    iina.raw.mpv.getString = () => '';
    startTrim(iina.api);
    iina.from('proposeSave', { crop: false, folder: '' });
    expect(iina.sent('saveProposal')).toEqual([]);
    expect(iina.sent('exportState')).toEqual([]);
  });
});

describe('export', () => {
  it('saves to the confirmed path, reports progress, then hides the sidebar', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('startExport', { ...range, folder: '/Users/me', name: 'mine.mkv' });

    await vi.waitFor(() => expect(iina.raw.core.resume).toHaveBeenCalled());
    const save = iina.exec.mock.calls.find((call) => call[0].endsWith('ffmpeg'));
    expect(save?.[1].at(-1)).toBe('/Users/me/mine.mkv');
    expect(iina.sent('exportProgress')).toEqual([{ fraction: 0.5 }, { fraction: 1 }]);
    expect(iina.sent('exportState').at(-1)).toMatchObject({ running: false, outcome: 'saved' });
    expect(iina.raw.sidebar.hide).toHaveBeenCalled();
  });

  it.each([
    ['an existing file', '/Movies', 'taken.mkv'],
    ['the source itself', '/Movies', 'demo.mkv'],
    ['a name with a slash', '/Movies', '../x.mkv'],
    ['a blank folder', '', 'x.mkv'],
  ])('refuses %s and keeps the panel usable', (_label, folder, name) => {
    const iina = fakeIina();
    iina.files.add('/Movies/taken.mkv');
    startTrim(iina.api);
    iina.from('startExport', { ...range, folder, name });
    expect(iina.exec).not.toHaveBeenCalled();
    expect(iina.sent('exportState')).toMatchObject([{ running: false, outcome: 'failed' }]);
  });

  it('reports a failed run and leaves the sidebar open', async () => {
    const iina = fakeIina();
    iina.exec.mockResolvedValue({ status: 1, stdout: '', stderr: 'bad' });
    startTrim(iina.api);
    iina.from('startExport', { ...range, folder: '/Users/me', name: 'mine.mkv' });

    await vi.waitFor(() => expect(iina.sent('exportState').at(-1)).toMatchObject({ outcome: 'failed' }));
    expect(iina.raw.sidebar.hide).not.toHaveBeenCalled();
  });
});

describe('previews', () => {
  it('shows the final frame of the clip for Out', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('previewWanted', { mark: 'out', time: 18, keyframe: false });

    await vi.waitFor(() => expect(iina.sent('framePreview')).toHaveLength(1));
    const preview = iina.exec.mock.calls.find((call) => call[0].endsWith('ffmpeg'));
    expect(preview?.[1]).toContain('-update');
  });

  it('returns the frame as a data URL with its real time, then removes the temp file', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('previewWanted', { mark: 'in', time: 100.5, keyframe: true });

    await vi.waitFor(() => expect(iina.sent('framePreview')).toHaveLength(1));
    expect(iina.sent('framePreview')[0]).toEqual({
      mark: 'in',
      time: 100.5,
      frameTime: 96.15,
      image: 'data:image/jpeg;base64,TQ==',
    });
    expect(iina.raw.file.delete).toHaveBeenCalled();
  });

  it('drops an older preview when a newer one was asked for', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('previewWanted', { mark: 'in', time: 1, keyframe: true });
    iina.from('previewWanted', { mark: 'in', time: 2, keyframe: true });

    await vi.waitFor(() => expect(iina.sent('framePreview').length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(iina.sent('framePreview').map((preview) => (preview as { time: number }).time)).toEqual([2]);
  });
});

describe('export progress', () => {
  it('ends a lossless copy before the first packet displayed at or after Out', async () => {
    const iina = fakeIina();
    iina.exec.mockImplementationOnce(async () => ({ status: 0, stdout: '20.04,19.92\n', stderr: '' }));
    startTrim(iina.api);
    iina.from('startExport', { ...range, folder: '/Users/me', name: 'mine.mkv' });

    await vi.waitFor(() => expect(iina.raw.core.resume).toHaveBeenCalled());
    const save = iina.exec.mock.calls.find((call) => call[0].endsWith('ffmpeg'));
    expect(save?.[1][save[1].indexOf('-t') + 1]).toBe('9.92');
  });

  it('counts the frames between the keyframe and In for a lossless clip', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('previewWanted', { mark: 'in', time: 100, keyframe: true });
    await vi.waitFor(() => expect(iina.sent('framePreview')).toHaveLength(1));

    iina.from('startExport', { ...range, inTime: 100, outTime: 106.15, folder: '/Users/me', name: 'mine.mkv' });
    await vi.waitFor(() => expect(iina.sent('exportProgress').length).toBeGreaterThan(0));
    expect(iina.sent('exportProgress')[0]).toEqual({ fraction: 0.5 });
  });
});

describe('keyframe steps', () => {
  it('moves In to the next keyframe, rounding up', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'in', time: 96.15, direction: 1 });

    await vi.waitFor(() => expect(iina.sent('stepEnded')).toEqual([{ mark: 'in', problem: '' }]));
    expect(iina.sent('markSet')).toEqual([{ mark: 'in', time: 102.16 }]);
  });

  it('pauses and moves the playhead with the step, so Set keeps the new keyframe', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'in', time: 96.15, direction: 1 });

    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(1));
    expect(iina.raw.core.pause).toHaveBeenCalled();
    expect(iina.raw.core.seekTo.mock.calls).toEqual([[102.16]]);
  });

  it('answers repeat presses from keyframes already read', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'in', time: 96.15, direction: -1 });
    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(1));
    const reads = iina.exec.mock.calls.length;

    iina.from('stepKeyframe', { mark: 'in', time: 90.15, direction: 1 });
    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(2));
    expect(iina.exec.mock.calls.length).toBe(reads);
    expect(iina.sent('markSet').at(-1)).toEqual({ mark: 'in', time: 96.15 });
  });

  it('forgets keyframes when another file opens', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'in', time: 96.15, direction: -1 });
    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(1));
    const reads = iina.exec.mock.calls.length;

    iina.events.get('iina.file-loaded')?.();
    iina.from('stepKeyframe', { mark: 'in', time: 90.15, direction: 1 });
    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(2));
    expect(iina.exec.mock.calls.length).toBe(reads + 1);
  });

  it('moves Out to the previous keyframe', async () => {
    const iina = fakeIina();
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'out', time: 96.15, direction: -1 });

    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(1));
    expect(iina.sent('markSet')).toEqual([{ mark: 'out', time: 90.15 }]);
  });

  it('widens the search, then reports when nothing is found', async () => {
    const iina = fakeIina();
    iina.exec.mockResolvedValue({ status: 0, stdout: '', stderr: '' });
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'in', time: 500, direction: 1 });

    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(1));
    expect(iina.exec).toHaveBeenCalledTimes(DEFAULT_SETTINGS.jogWindows.length);
    expect(iina.sent('stepEnded')[0]).toMatchObject({ problem: expect.stringContaining('No keyframe') });
  });

  it('explains when ffprobe is missing', async () => {
    const iina = fakeIina();
    iina.files.delete('/opt/homebrew/bin/ffprobe');
    startTrim(iina.api);
    iina.from('stepKeyframe', { mark: 'in', time: 5, direction: 1 });

    await vi.waitFor(() => expect(iina.sent('stepEnded')).toHaveLength(1));
    expect(iina.sent('stepEnded')[0]).toMatchObject({ problem: expect.stringContaining('ffprobe') });
    expect(iina.exec).not.toHaveBeenCalled();
  });
});
