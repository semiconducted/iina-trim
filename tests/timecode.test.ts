import { describe, expect, it } from 'vitest';
import { fromTimecode, toTimecode } from '../src/shared/timecode';

describe('fromTimecode', () => {
  it.each([
    ['83', 83],
    ['1:23', 83],
    [' 0:01:23.5 ', 83.5],
    ['01:02:03.250', 3_723.25],
    ['100:00:00', 360_000],
  ])('reads %s', (text, seconds) => {
    expect(fromTimecode(text)).toBe(seconds);
  });

  it.each(['', 'abc', '1:60', '1:60:00', '1:2:3:4', '-5', '1.5:00', ':5'])('rejects "%s"', (text) => {
    expect(fromTimecode(text)).toBeUndefined();
  });
});

describe('toTimecode', () => {
  it('shows hours, minutes, seconds and milliseconds', () => {
    expect(toTimecode(3_723.25)).toBe('01:02:03.250');
    expect(toTimecode(59.9996)).toBe('00:01:00.000');
  });

  it('treats unusable input as zero', () => {
    expect(toTimecode(-4)).toBe('00:00:00.000');
    expect(toTimecode(Number.NaN)).toBe('00:00:00.000');
  });

  it('survives a round trip to the millisecond', () => {
    expect(fromTimecode(toTimecode(83.4567))).toBe(83.457);
  });
});
