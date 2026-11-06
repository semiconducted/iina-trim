import { describe, expect, it } from 'vitest';
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
} from '../src/plugin/commands';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const settings = {
  ...DEFAULT_SETTINGS,
  videotoolboxQuality: 55,
  x264Crf: 18,
  thumbnailMaxWidth: 300,
  thumbnailJpegQuality: 9,
};
const range = { inTime: 70.2, outTime: 85.5, useHardware: true, crop: false };
const valueAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

describe('finding tools', () => {
  it('prefers the chosen ffmpeg, then Homebrew', () => {
    const exists = (path: string): boolean => ['/my/ffmpeg', '/opt/homebrew/bin/ffmpeg'].includes(path);
    expect(findFfmpeg(' /my/ffmpeg ', exists)).toBe('/my/ffmpeg');
    expect(findFfmpeg('', exists)).toBe('/opt/homebrew/bin/ffmpeg');
    expect(findFfmpeg(undefined, () => false)).toBeUndefined();
  });

  it('looks for ffprobe beside ffmpeg first', () => {
    const exists = (path: string): boolean => ['/my/ffprobe', '/opt/homebrew/bin/ffprobe'].includes(path);
    expect(findFfprobe('/my/ffmpeg', exists)).toBe('/my/ffprobe');
    expect(findFfprobe('/other/ffmpeg', exists)).toBe('/opt/homebrew/bin/ffprobe');
  });
});

describe('exportArgs', () => {
  it('copies streams without encoding when not cropping', () => {
    const args = exportArgs('/M/a.mp4', range, '/M/b.mp4', settings);
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(valueAfter(args, '-ss')).toBe('70.2');
    expect(valueAfter(args, '-t')).toBe('15.3');
    expect(valueAfter(args, '-c')).toBe('copy');
    expect(args).not.toContain('-hwaccel');
    expect(args.at(-1)).toBe('/M/b.mp4');
  });

  it('never overwrites, reports progress and skips a second pass', () => {
    for (const crop of [false, true]) {
      const args = exportArgs('/M/a.mp4', { ...range, crop }, '/M/b.mp4', settings);
      expect(args.slice(0, 4)).toEqual(['-n', '-nostats', '-progress', 'pipe:1']);
      expect(args).not.toContain('-movflags');
    }
  });

  it('uses the chosen encoder and quality when cropping', () => {
    const hardware = exportArgs('/M/a.mp4', { ...range, crop: true }, '/M/b.mov', settings);
    expect(valueAfter(hardware, '-hwaccel')).toBe('videotoolbox');
    expect(valueAfter(hardware, '-c:v')).toBe('h264_videotoolbox');
    expect(valueAfter(hardware, '-q:v')).toBe('55');
    expect(valueAfter(hardware, '-copypriorss')).toBe('0');

    const software = exportArgs('/M/a.mp4', { ...range, crop: true, useHardware: false }, '/M/b.mov', settings);
    expect(software).not.toContain('-hwaccel');
    expect(valueAfter(software, '-c:v')).toBe('libx264');
    expect(valueAfter(software, '-crf')).toBe('18');
  });
});

describe('previewArgs', () => {
  it('stops on the keyframe only when asked', () => {
    expect(previewArgs('/M/a.mp4', 100.5, 'keyframe', '/t.jpg', settings)).toContain('-noaccurate_seek');
    expect(previewArgs('/M/a.mp4', 100.5, 'at', '/t.jpg', settings)).not.toContain('-noaccurate_seek');
  });

  it('renders one frame at twice the maximum width', () => {
    const args = previewArgs('/M/a.mp4', 1, 'keyframe', '/t.jpg', settings);
    expect(valueAfter(args, '-frames:v')).toBe('1');
    expect(args).toContain('showinfo,scale=600:-2');
    expect(valueAfter(args, '-q:v')).toBe('9');
    expect(args.at(-1)).toBe('/t.jpg');
  });
});

describe('the last frame before Out', () => {
  it('keeps only frames before the time and writes the final one', () => {
    const args = previewArgs('/M/a.mp4', 18.5, 'lastBefore', '/t.jpg', settings);
    expect(valueAfter(args, '-ss')).toBe('17.5');
    expect(valueAfter(args, '-to')).toBe('18.5');
    expect(valueAfter(args, '-vf')).toBe("select='lt(t,18.5)',showinfo,scale=600:-2");
    expect(valueAfter(args, '-update')).toBe('1');
    expect(args).not.toContain('-frames:v');
  });

  it('never seeks before the start of the file', () => {
    expect(valueAfter(previewArgs('/M/a.mp4', 0.4, 'lastBefore', '/t.jpg', settings), '-ss')).toBe('0');
  });
});

describe('ending a lossless copy', () => {
  const cut = { inTime: 18, outTime: 24, useHardware: false, crop: false };
  // Decode order: frames display after they decode, as with B-frames.
  const packets = ['23.96,23.84', '23.88,23.88', '24.00,23.92', '24.08,23.96', ''].join('\n');

  it('stops before the first packet that displays at or after Out', () => {
    expect(copyLengthBefore(packets, cut)).toBe(5.92);
  });

  it('rounds down, so that packet can never slip through', () => {
    expect(copyLengthBefore('24.5,23.9217\n', cut)).toBe(5.921);
  });

  it('gives up when no packet reaches Out or the numbers make no sense', () => {
    expect(copyLengthBefore('20,19.9\n', cut)).toBeUndefined();
    expect(copyLengthBefore('N/A,N/A\n', cut)).toBeUndefined();
    expect(copyLengthBefore('24,17\n', cut)).toBeUndefined();
  });

  it('uses the found length only for a lossless clip', () => {
    const lossless = exportArgs('/M/a.mp4', cut, '/M/b.mp4', settings, 5.92);
    expect(valueAfter(lossless, '-t')).toBe('5.92');
    const cropped = exportArgs('/M/a.mp4', { ...cut, crop: true }, '/M/b.mov', settings, 5.92);
    expect(valueAfter(cropped, '-t')).toBe('6');
    expect(valueAfter(exportArgs('/M/a.mp4', cut, '/M/b.mp4', settings), '-t')).toBe('6');
  });

  it('probes packets around Out', () => {
    expect(valueAfter(packetProbeArgs('/M/a.mp4', 24), '-read_intervals')).toBe('22%26');
    expect(valueAfter(packetProbeArgs('/M/a.mp4', 1), '-read_intervals')).toBe('0%3');
  });
});

describe('reading tool output', () => {
  it('reads the newest progress position', () => {
    expect(readProgress('out_time_us=1000000\nprogress=continue\nout_time_us=2500000\n')).toBe(2.5);
    expect(readProgress('frame=1')).toBeUndefined();
  });

  it('reads the frame written, which is not the extra one showinfo logs after it', () => {
    const log = 'pts_time:96.15865 iskey:1\npts_time:96.19 iskey:0';
    expect(readFrameTime(log, 'keyframe')).toBe(96.15865);
    expect(readFrameTime(log, 'at')).toBe(96.15865);
    expect(readFrameTime('no frames', 'keyframe')).toBeUndefined();
  });

  it('reads the final frame for lastBefore', () => {
    expect(readFrameTime('pts_time:17 x\npts_time:17.96 y', 'lastBefore')).toBe(17.96);
  });

  it('sorts keyframes, drops repeats and ignores blank lines', () => {
    expect(readKeyframes('96.158650\n90.152650,\n\n102.164650\n96.158650\n')).toEqual([90.15265, 96.15865, 102.16465]);
  });
});

describe('stepping between keyframes', () => {
  const keyframes = [90.15265, 96.15865, 102.16465];

  it('moves past the keyframe currently shown', () => {
    expect(adjacentKeyframe(keyframes, 96.15865, 1)).toBe(102.16465);
    expect(adjacentKeyframe(keyframes, 96.15865, -1)).toBe(90.15265);
    expect(adjacentKeyframe(keyframes, 96.159, -1)).toBe(90.15265);
    expect(adjacentKeyframe(keyframes, 102.16465, 1)).toBeUndefined();
  });

  it('answers from known keyframes only inside the range read', () => {
    expect(knownNeighbor(keyframes, 96.15865, 1)).toBe(102.16465);
    expect(knownNeighbor(keyframes, 96.15865, -1)).toBe(90.15265);
    expect(knownNeighbor(keyframes, 100, -1)).toBe(96.15865);
    expect(knownNeighbor(keyframes, 102.16465, 1)).toBeUndefined();
    expect(knownNeighbor(keyframes, 90.15265, -1)).toBeUndefined();
    expect(knownNeighbor(keyframes, 80, 1)).toBeUndefined();
    expect(knownNeighbor(keyframes, 110, -1)).toBeUndefined();
    expect(knownNeighbor([], 5, 1)).toBeUndefined();
  });

  it('joins keyframe runs that touch, and never bridges a gap', () => {
    expect(mergeKeyframes([1, 2, 3], [3, 4])).toEqual([1, 2, 3, 4]);
    expect(mergeKeyframes([3, 4], [1, 2, 3])).toEqual([1, 2, 3, 4]);
    expect(mergeKeyframes([1, 2], [5, 6])).toEqual([5, 6]);
    expect(mergeKeyframes([1, 2], [])).toEqual([1, 2]);
    expect(mergeKeyframes([], [1, 2])).toEqual([1, 2]);
  });

  it('rounds In up and Out down', () => {
    expect(markTimeAt(96.15865, 'in')).toBe(96.159);
    expect(markTimeAt(96.15865, 'out')).toBe(96.158);
  });

  it('never probes before the start of the file', () => {
    const args = keyframeProbeArgs('/M/a.mp4', -5, 20.0004);
    expect(args).toContain('nokey');
    expect(valueAfter(args, '-read_intervals')).toBe('0%20');
  });
});

describe('toBase64', () => {
  const bytes = (text: string): number[] => [...text].map((letter) => letter.charCodeAt(0));

  it('pads correctly', () => {
    expect(toBase64(bytes('Man'))).toBe('TWFu');
    expect(toBase64(bytes('Ma'))).toBe('TWE=');
    expect(toBase64(bytes('M'))).toBe('TQ==');
    expect(toBase64(bytes(''))).toBe('');
  });

  it('handles a zero byte at the end and high bytes', () => {
    expect(toBase64([255, 0, 128, 7])).toBe('/wCABw==');
    expect(toBase64([65, 0])).toBe('QQA=');
  });
});
