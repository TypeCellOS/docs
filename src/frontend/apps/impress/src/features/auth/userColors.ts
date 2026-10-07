// Use the original cursor's pastel HSL ranges, seeded by identity rather than
// Math.random so cursors, avatars and author highlights agree across sessions.
export const userColorsForId = (id: string) => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }

  const nextInt = (min: number, max: number) => {
    hash = (hash + 0x6d2b79f5) | 0;
    let value = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    const fraction = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    return min + Math.floor(fraction * (max - min + 1));
  };

  const hue = nextInt(0, 360);
  const saturation = nextInt(42, 98);
  const lightness = nextInt(70, 90);

  return {
    color: hslToHex(hue, saturation, lightness),
    colorLight: hslToHex(hue, saturation, 96),
  };
};

function hslToHex(h: number, s: number, l: number) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
