import type { Mark, ClipRange } from '../shared/messages';
import type { Settings } from '../shared/settings';
import { folderOf, joinPath } from './paths';

const INSTALL_FOLDERS = ['/opt/homebrew/bin', '/usr/local/bin'];

// A centered 9:16 window, full height. FFmpeg centers a crop by default.
const VERTICAL_CROP = 'crop=ih*9/16:ih,format=yuv420p';

const toMilliseconds = (seconds: number): number => Math.round(seconds * 1_000) / 1_000;

export function findFfmpeg(chosenPath: unknown, exists: (path: string) => boolean): string | undefined {
  const chosen = typeof chosenPath === 'string' ? chosenPath.trim() : '';
  const places = [chosen, ...INSTALL_FOLDERS.map((folder) => joinPath(folder, 'ffmpeg'))];
  return places.find((place) => place !== '' && exists(place));
}

// ffprobe ships beside ffmpeg in Homebrew and most other builds.
export function findFfprobe(ffmpegFile: string, exists: (path: string) => boolean): string | undefined {
  const folders = [folderOf(ffmpegFile), ...INSTALL_FOLDERS];
  return folders
    .filter((folder) => folder !== '')
    .map((folder) => joinPath(folder, 'ffprobe'))
    .find((place) => exists(place));
}

// Without crop, packets are copied untouched, so the clip starts on the keyframe
// at or before In. A second pass such as faststart is avoided on purpose: it
// rewrites the whole file after progress has reached 100%.
export function exportArgs(
  source: string,
  range: ClipRange,
  target: string,
  settings: Settings,
  copyLength?: number,
): string[] {
  const start = String(toMilliseconds(range.inTime));
  const length = String(toMilliseconds(range.crop ? range.outTime - range.inTime : (copyLength ?? range.outTime - range.inTime)));
  const always = ['-n', '-nostats', '-progress', 'pipe:1'];

  if (!range.crop) {
    return [...always, '-ss', start, '-i', source, '-t', length, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', target];
  }

  const decoder = range.useHardware ? ['-hwaccel', 'videotoolbox'] : [];
  const encoder = range.useHardware
    ? ['-c:v', 'h264_videotoolbox', '-q:v', String(settings.videotoolboxQuality)]
    : ['-c:v', 'libx264', '-crf', String(settings.x264Crf)];
  // -copypriorss 0 drops copied audio from before In. Kept, it would play over a
  // blank start in formats without edit lists, such as mkv.
  return [...always, ...decoder, '-ss', start, '-i', source, '-t', length, '-vf', VERTICAL_CROP, ...encoder, '-c:a', 'copy', '-copypriorss', '0', target];
}

export function packetProbeArgs(source: string, outTime: number): string[] {
  const span = `${toMilliseconds(Math.max(0, outTime - 2))}%${toMilliseconds(outTime + 2)}`;
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,dts_time', '-of', 'csv=p=0', '-read_intervals', span, source];
}

// A copy stops at the first packet whose decode time reaches its length, but
// frames display later than they decode, so a plain length lets frames past Out
// through, including the first frames of the next scene. Stopping at the first
// packet that displays at or after Out keeps them out.
export function copyLengthBefore(packets: string, range: ClipRange): number | undefined {
  let stop = Number.POSITIVE_INFINITY;
  for (const line of packets.split('\n')) {
    const [shown, decoded] = line.split(',').map(Number);
    if (shown !== undefined && decoded !== undefined && shown >= range.outTime && decoded < stop) stop = decoded;
  }
  const length = Math.floor((stop - range.inTime) * 1_000) / 1_000;
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

export type PreviewFrame = 'keyframe' | 'at' | 'lastBefore';

// keyframe stops on the keyframe before the time instead of decoding forward to
// it. lastBefore shows the final frame of a clip ending at the time. -copyts
// keeps source times so showinfo reports the real one.
export function previewArgs(source: string, time: number, frame: PreviewFrame, target: string, settings: Settings): string[] {
  const at = toMilliseconds(time);
  const size = `showinfo,scale=${settings.thumbnailMaxWidth * 2}:-2`;
  const quality = ['-q:v', String(settings.thumbnailJpegQuality)];

  if (frame === 'lastBefore') {
    return ['-hide_banner', '-nostdin', '-ss', String(Math.max(0, at - 1)), '-copyts', '-i', source, '-to', String(at), '-map', '0:v:0', '-vf', `select='lt(t,${at})',${size}`, ...quality, '-update', '1', '-y', target];
  }

  return [
    '-hide_banner',
    '-nostdin',
    ...(frame === 'keyframe' ? ['-noaccurate_seek'] : []),
    '-ss',
    String(at),
    '-copyts',
    '-i',
    source,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-vf',
    // Twice the largest display width, so previews stay sharp on Retina screens.
    size,
    ...quality,
    '-y',
    target,
  ];
}

export function keyframeProbeArgs(source: string, from: number, to: number): string[] {
  const span = `${toMilliseconds(Math.max(0, from))}%${toMilliseconds(Math.max(0, to))}`;
  return ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', '-read_intervals', span, source];
}

// The newest position in ffmpeg -progress output, in seconds.
export function readProgress(output: string): number | undefined {
  const positions = output.match(/out_time_us=\d+/g);
  const last = positions?.[positions.length - 1];
  return last === undefined ? undefined : Number(last.slice('out_time_us='.length)) / 1_000_000;
}

// showinfo sees one frame past a -frames:v limit, so the first line is the frame
// written. With lastBefore every frame is written over the one before, so it is the last.
export function readFrameTime(log: string, frame: PreviewFrame): number | undefined {
  const times = [...log.matchAll(/pts_time:(-?[\d.]+)/g)];
  const found = (frame === 'lastBefore' ? times[times.length - 1] : times[0])?.[1];
  return found === undefined ? undefined : Number(found);
}

export function readKeyframes(output: string): number[] {
  const times = output
    .split('\n')
    .map((line) => line.split(',')[0]?.trim() ?? '')
    .filter((field) => field !== '')
    .map(Number)
    .filter(Number.isFinite);
  return [...new Set(times)].sort((a, b) => a - b);
}

// Marks are rounded to 1 ms, so anything within 2 ms counts as the same keyframe.
const SAME_KEYFRAME = 0.002;

export function adjacentKeyframe(times: number[], from: number, direction: -1 | 1): number | undefined {
  if (direction === 1) return times.find((time) => time > from + SAME_KEYFRAME);
  return times.filter((time) => time < from - SAME_KEYFRAME).pop();
}

// A neighbor from keyframes already read, which run unbroken from first to last.
// Undefined means the time is at or past an edge, so the file must be read.
export function knownNeighbor(known: number[], time: number, direction: -1 | 1): number | undefined {
  const first = known[0];
  const last = known[known.length - 1];
  if (first === undefined || last === undefined) return undefined;
  if (time < first - SAME_KEYFRAME || time > last + SAME_KEYFRAME) return undefined;
  return adjacentKeyframe(known, time, direction);
}

// Joins two runs of keyframes when they touch. Otherwise only the newest is kept,
// because a gap between them could hide keyframes.
export function mergeKeyframes(known: number[], found: number[]): number[] {
  const knownFirst = known[0];
  const knownLast = known[known.length - 1];
  const foundFirst = found[0];
  const foundLast = found[found.length - 1];
  if (foundFirst === undefined || foundLast === undefined) return known;
  if (knownFirst === undefined || knownLast === undefined) return found;
  if (foundFirst > knownLast + SAME_KEYFRAME || foundLast < knownFirst - SAME_KEYFRAME) return found;
  return [...new Set([...known, ...found])].sort((a, b) => a - b);
}

// In rounds up so that keyframe stays the lossless start. Out rounds down so the
// keyframe, usually the first frame of the next scene, is left out of the clip.
export function markTimeAt(keyframe: number, mark: Mark): number {
  const round = mark === 'in' ? Math.ceil : Math.floor;
  return round(keyframe * 1_000) / 1_000;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The plugin runtime has no dependable btoa.
export function toBase64(bytes: ArrayLike<number>): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const left = bytes.length - at;
    const group = ((bytes[at] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0);
    out += BASE64.charAt((group >> 18) & 63) + BASE64.charAt((group >> 12) & 63);
    out += left > 1 ? BASE64.charAt((group >> 6) & 63) : '=';
    out += left > 2 ? BASE64.charAt(group & 63) : '=';
  }
  return out;
}
