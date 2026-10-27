/** Relative luminance for a `#rrggbb` color. 0 is black, 1 is white. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. 1 means the two colors are the same. */
export function contrastRatio(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pull a hex color toward dark or light until it clears `min` contrast.
 * Named ANSI colors are returned unchanged; callers substitute those first.
 */
export function contrastAtLeast(color: string, background: string, min = 4.5): string {
  if (!isHex(color) || !isHex(background) || contrastRatio(color, background) >= min) return color;
  const towardDark = luminance(background) > 0.5;
  const target: [number, number, number] = towardDark ? [28, 25, 23] : [245, 245, 244];
  const origin = hexToRgb(color);
  if (!origin) return color;
  let best = color;
  for (let step = 1; step <= 8; step++) {
    const mix = step / 8;
    const next = toHex([
      Math.round(origin[0] + (target[0] - origin[0]) * mix),
      Math.round(origin[1] + (target[1] - origin[1]) * mix),
      Math.round(origin[2] + (target[2] - origin[2]) * mix),
    ]);
    best = next;
    if (contrastRatio(next, background) >= min) return next;
  }
  return best;
}

export function isHex(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function toHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
