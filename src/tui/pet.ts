/**
 * Startup header pet: a small side-view horse, drawn with quadrant blocks
 * so it sits in a few terminal rows beside the version text.
 * '.' is empty, '#' is body, 'o' is the eye (left empty so the background shows through).
 */

/** Purple of the Glue horse. */
export const PET_COLOR = "#9B6BFF";

/** Sticky header rows. The transcript budget reserves this many lines. */
export const STARTUP_HEADER_ROWS = 4;

export const HORSE_PIXELS: readonly string[] = [
  "..............##....",
  "............####o#..",
  "..........##########",
  "..##############....",
  "################....",
  "################....",
  "..##..##..##..##....",
  "..##..##..##..##....",
];

/** Bits are upper-left, upper-right, lower-left, lower-right. */
const QUADRANT = [
  " ", "▗", "▖", "▄",
  "▝", "▐", "▞", "▟",
  "▘", "▚", "▌", "▙",
  "▀", "▜", "▛", "█",
];

/** Pack an even-height pixel grid into terminal rows. Trailing spaces are dropped. */
export function pixelsToRows(pixels: readonly string[]): string[] {
  if (pixels.length % 2 !== 0) throw new Error("pixel rows must be even");
  const width = pixels.reduce((max, row) => Math.max(max, row.length), 0);
  const rows: string[] = [];
  for (let y = 0; y < pixels.length; y += 2) {
    let line = "";
    for (let x = 0; x < width; x += 2) {
      const bit = (dx: number, dy: number) => (pixels[y + dy]?.[x + dx] === "#" ? 1 : 0);
      const mask = (bit(0, 0) << 3) | (bit(1, 0) << 2) | (bit(0, 1) << 1) | bit(1, 1);
      line += QUADRANT[mask] ?? " ";
    }
    rows.push(line.replace(/\s+$/, ""));
  }
  return rows;
}

/** Four terminal rows, left-aligned. The tail is the left edge; the head faces right. */
export function horseRows(): string[] {
  return pixelsToRows(HORSE_PIXELS);
}
