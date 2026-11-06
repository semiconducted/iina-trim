const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

// Seconds to HH:MM:SS.mmm. Negative or non-finite input becomes zero.
export function toTimecode(seconds: number): string {
  const totalMs = Math.round((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * 1_000);
  const whole = Math.floor(totalMs / 1_000);
  const clock = [Math.floor(whole / 3_600), Math.floor(whole / 60) % 60, whole % 60];
  return `${clock.map((part) => pad(part)).join(':')}.${pad(totalMs % 1_000, 3)}`;
}

// Accepts 83, 1:23 or 0:01:23.5. Returns undefined for anything else.
export function fromTimecode(text: string): number | undefined {
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return undefined;

  const hours = match[1];
  const minutes = match[2];
  const seconds = Number(match[3]);
  if (minutes !== undefined && seconds >= 60) return undefined;
  if (hours !== undefined && Number(minutes) >= 60) return undefined;
  return Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + seconds;
}
