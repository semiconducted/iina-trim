import type { ClipRange, Mark, SaveTarget, ToPlugin, ToSidebar } from '../shared/messages';
import { keyLabel, readSettings, type Settings } from '../shared/settings';
import { toTimecode } from '../shared/timecode';
import {
  adjacentKeyframe,
  copyLengthBefore,
  exportArgs,
  findFfmpeg,
  findFfprobe,
  keyframeProbeArgs,
  knownNeighbor,
  markTimeAt,
  mergeKeyframes,
  packetProbeArgs,
  previewArgs,
  readFrameTime,
  readKeyframes,
  readProgress,
  toBase64,
} from './commands';
import { folderOf, freeClipName, isLocalFile, isPlainFileName, joinPath } from './paths';

const isMark = (value: unknown): value is Mark => value === 'in' || value === 'out';
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isRange(value: unknown): value is ClipRange {
  const range = value as Partial<ClipRange> | null;
  return (
    isTime(range?.inTime) &&
    isTime(range?.outTime) &&
    range.outTime > range.inTime &&
    typeof range.useHardware === 'boolean' &&
    typeof range.crop === 'boolean'
  );
}

function isTarget(value: unknown): value is SaveTarget {
  const target = value as Partial<SaveTarget> | null;
  return typeof target?.folder === 'string' && typeof target.name === 'string';
}

export function startTrim(api: IINA.IINAGlobal): void {
  const { core, sidebar, utils } = api;
  const exists = (path: string): boolean => utils.fileInPath(path);
  const settings = (): Settings => readSettings((key) => api.preferences.get(key));
  const send = <K extends keyof ToSidebar>(name: K, data: ToSidebar[K]): void =>
    sidebar.postMessage(name, data);

  const boundKeys = settings().shortcuts;
  // Kept here too, so a sidebar still loading when a shortcut fires gets them later.
  const marks = new Map<Mark, number>();
  // The newest preview per mark; a slower, older one is dropped.
  const newestPreview = new Map<Mark, number>();
  let previewCount = 0;
  // Keyframes read so far from this file, so repeated arrow presses stay instant.
  let knownKeyframes: number[] = [];
  // The keyframe a lossless clip would start on, as last shown for In.
  let inFrame: { time: number; frameTime: number } | undefined;
  let pageLoaded = false;

  const ffmpeg = (): string | undefined => findFfmpeg(api.preferences.get('ffmpeg_location'), exists);

  function localSource(): { path: string; name: string } | undefined {
    const path = api.mpv.getString('path');
    const name = api.mpv.getString('filename');
    return name && isLocalFile(path) ? { path, name } : undefined;
  }

  function sendSidebarState(): void {
    const { thumbnailMinWidth, thumbnailMaxWidth } = settings();
    send('ffmpegState', { found: ffmpeg() !== undefined });
    send('sidebarConfig', {
      minWidth: thumbnailMinWidth,
      maxWidth: thumbnailMaxWidth,
      inKey: keyLabel(boundKeys.setIn),
      outKey: keyLabel(boundKeys.setOut),
    });
  }

  function markPlayhead(mark: Mark): void {
    // Rounded the same way as a keyframe step, so a playhead on a keyframe stays on it.
    const time = markTimeAt(api.mpv.getNumber('time-pos'), mark);
    marks.set(mark, time);
    send('markSet', { mark, time });
    core.osd(`${mark === 'in' ? 'In' : 'Out'} ${toTimecode(time)}`);
  }

  async function makePreview(mark: Mark, time: number, keyframe: boolean): Promise<void> {
    const ticket = ++previewCount;
    newestPreview.set(mark, ticket);
    const reply = (image: string, frameTime: number | null): void => {
      if (newestPreview.get(mark) === ticket) send('framePreview', { mark, time, frameTime, image });
    };

    const tool = ffmpeg();
    const source = localSource();
    if (!tool || !source) {
      reply('', null);
      return;
    }

    const output = utils.resolvePath(`@tmp/preview-${mark}-${ticket}.jpg`);
    try {
      await utils.exec('/bin/mkdir', ['-p', folderOf(output)]);
      const frame = keyframe ? 'keyframe' : mark === 'out' ? 'lastBefore' : 'at';
      const run = await utils.exec(tool, previewArgs(source.path, time, frame, output, settings()));
      if (run.status !== 0 || !exists(output)) {
        reply('', null);
        return;
      }
      const file = api.file.handle(output, 'read');
      const bytes = file.readToEnd();
      file.close();
      if (!bytes?.length) {
        reply('', null);
        return;
      }
      const frameTime = readFrameTime(run.stderr, frame) ?? null;
      if (mark === 'in' && keyframe && frameTime !== null) inFrame = { time, frameTime };
      reply(`data:image/jpeg;base64,${toBase64(bytes)}`, frameTime);
    } catch (error) {
      api.console.error(`Trim preview failed: ${String(error)}`);
      reply('', null);
    } finally {
      if (exists(output)) api.file.delete(output);
    }
  }

  // Looks in the first window, then the wider one for files with few keyframes.
  async function findAdjacentKeyframe(probe: string, source: string, time: number, direction: -1 | 1): Promise<number | undefined> {
    const known = knownNeighbor(knownKeyframes, time, direction);
    if (known !== undefined) return known;

    for (const reach of settings().jogWindows) {
      const [from, to] = direction === 1 ? [time, time + reach] : [time - reach, time];
      const run = await utils.exec(probe, keyframeProbeArgs(source, from, to));
      if (run.status !== 0) throw new Error(`ffprobe stopped with code ${run.status}`);

      const times = readKeyframes(run.stdout);
      knownKeyframes = mergeKeyframes(knownKeyframes, times);
      const found = adjacentKeyframe(times, time, direction);
      if (found !== undefined) return found;
      if (direction === -1 && from <= 0) return undefined;
    }
    return undefined;
  }

  async function stepKeyframe(mark: Mark, time: number, direction: -1 | 1): Promise<void> {
    const tool = ffmpeg();
    const probe = tool && findFfprobe(tool, exists);
    const source = localSource();
    let problem = '';

    if (!probe) problem = 'ffprobe was not found next to FFmpeg.';
    else if (!source) problem = 'Open a local video first.';
    else {
      try {
        const keyframe = await findAdjacentKeyframe(probe, source.path, time, direction);
        if (keyframe === undefined) {
          problem = `No keyframe found ${direction === 1 ? 'after' : 'before'} this point.`;
        } else {
          const markTime = markTimeAt(keyframe, mark);
          marks.set(mark, markTime);
          send('markSet', { mark, time: markTime });
          // The playhead follows, so the video shows the cut and Set In or Set Out keeps it.
          core.pause();
          core.seekTo(keyframe);
        }
      } catch (error) {
        problem = `Keyframe search failed: ${String(error)}`;
      }
    }
    send('stepEnded', { mark, problem });
  }

  function proposeSave(crop: boolean, folder: string): void {
    const source = localSource();
    if (!source) return;
    const place = folder || folderOf(source.path);
    send('saveProposal', { folder: place, name: freeClipName(place, source.name, !crop, exists, settings()) });
  }

  function pickFolder(crop: boolean): void {
    const chosen = utils.chooseFile('Choose where to save the clip', { chooseDir: true });
    if (chosen) proposeSave(crop, chosen.replace(/(.)\/+$/, '$1'));
  }

  // How long a lossless copy should run; undefined falls back to Out minus In.
  async function findCopyLength(tool: string, source: string, range: ClipRange): Promise<number | undefined> {
    const probe = findFfprobe(tool, exists);
    if (!probe) return undefined;
    const run = await utils.exec(probe, packetProbeArgs(source, range.outTime));
    return run.status === 0 ? copyLengthBefore(run.stdout, range) : undefined;
  }

  async function startExport(job: ClipRange & SaveTarget): Promise<void> {
    const stop = (message: string): void => {
      send('exportState', { running: false, outcome: 'failed', message });
      core.osd(message);
    };

    const tool = ffmpeg();
    const source = localSource();
    if (!tool) return stop('FFmpeg was not found. Set its path in Trim preferences.');
    if (!source) return stop('Open a local video first.');
    if (job.folder === '' || !isPlainFileName(job.name)) {
      return stop('Use a file name with no slashes, colons or leading dot.');
    }

    const target = joinPath(job.folder, job.name);
    if (target === source.path) return stop('A clip cannot replace its source video.');
    if (exists(target)) return stop(`${job.name} already exists. Choose another name.`);

    send('exportState', { running: true, outcome: 'none', message: '' });
    core.osd('Saving clip');

    // A lossless clip also holds the frames from its keyframe up to In.
    const start = !job.crop && inFrame?.time === job.inTime ? inFrame.frameTime : job.inTime;
    const length = job.outTime - start;
    let recent = '';
    const onProgress = (chunk: string): void => {
      // Enough to always hold the newest complete block of progress lines.
      recent = (recent + chunk).slice(-2_000);
      const position = readProgress(recent);
      if (position !== undefined) send('exportProgress', { fraction: Math.min(1, position / length) });
    };

    try {
      const copyLength = job.crop ? undefined : await findCopyLength(tool, source.path, job);
      const args = exportArgs(source.path, job, target, settings(), copyLength);
      const run = await utils.exec(tool, args, null, onProgress, null);
      if (run.status !== 0) {
        api.console.error(run.stderr);
        stop(`FFmpeg stopped with code ${run.status}.`);
        return;
      }
      send('exportProgress', { fraction: 1 });
      send('exportState', { running: false, outcome: 'saved', message: `Saved ${target}` });
      core.osd(`Saved ${job.name}`);
      sidebar.hide();
      core.resume();
    } catch (error) {
      stop(`The clip could not be saved: ${String(error)}`);
    }
  }

  function listen(): void {
    const on = (topic: keyof ToPlugin, act: (body: unknown) => void): void =>
      sidebar.onMessage(topic, act);

    on('sidebarReady', () => {
      sendSidebarState();
      for (const [mark, time] of marks) send('markSet', { mark, time });
    });
    on('markPlayhead', (data) => {
      const { mark } = data as Partial<ToPlugin['markPlayhead']>;
      if (isMark(mark)) markPlayhead(mark);
    });
    on('seek', (data) => {
      const { time } = data as Partial<ToPlugin['seek']>;
      if (isTime(time)) core.seekTo(time);
    });
    on('previewWanted', (data) => {
      const { mark, time, keyframe } = data as Partial<ToPlugin['previewWanted']>;
      if (isMark(mark) && isTime(time)) void makePreview(mark, time, keyframe === true);
    });
    on('stepKeyframe', (data) => {
      const { mark, time, direction } = data as Partial<ToPlugin['stepKeyframe']>;
      if (isMark(mark) && isTime(time) && (direction === 1 || direction === -1)) {
        void stepKeyframe(mark, time, direction);
      }
    });
    on('proposeSave', (data) => {
      const { crop, folder } = data as Partial<ToPlugin['proposeSave']>;
      if (typeof crop === 'boolean' && typeof folder === 'string') proposeSave(crop, folder);
    });
    on('pickFolder', (data) => {
      pickFolder((data as Partial<ToPlugin['pickFolder']>).crop === true);
    });
    on('startExport', (data) => {
      if (isRange(data) && isTarget(data)) void startExport(data);
    });
  }

  // IINA cannot load a sidebar until the player window exists, and loading one
  // drops earlier listeners, so listeners are always attached after the load.
  function ensurePage(): void {
    if (pageLoaded) return;
    sidebar.loadFile('dist/sidebar.html');
    listen();
    pageLoaded = true;
  }

  function openPage(): boolean {
    if (!core.window.loaded) return false;
    ensurePage();
    sidebar.show();
    sendSidebarState();
    return true;
  }

  const addCommand = (title: string, key: string, action: () => void): void =>
    api.menu.addItem(api.menu.item(title, action, { keyBinding: key }));

  addCommand('Open Trim', boundKeys.open, () => {
    openPage();
  });
  addCommand('Set Clip In', boundKeys.setIn, () => {
    if (openPage()) markPlayhead('in');
  });
  addCommand('Set Clip Out', boundKeys.setOut, () => {
    if (openPage()) markPlayhead('out');
  });

  // Marks belong to one file.
  api.event.on('iina.file-loaded', () => {
    marks.clear();
    newestPreview.clear();
    inFrame = undefined;
    knownKeyframes = [];
    if (pageLoaded) send('marksCleared', {});
  });

  if (core.window.loaded) ensurePage();
  else api.event.on('iina.window-loaded', ensurePage);
}
