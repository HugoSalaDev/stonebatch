import { readFileSync } from 'node:fs';

import type { Font, PathCommand } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CURVE_TOLERANCE_MM,
  FONT_ASSET_SHA256,
  FONT_ASSET_URL,
  LETTER_SPACING_MM,
  createTextGeometry,
  loadMontserratBlack,
  parseMontserratBlack,
  type PointMm,
} from '../src/lib/engine/font-outlines';

const FONT_PATH = new URL('../public/fonts/montserrat-black-900-v25.woff', import.meta.url);
const FONT_BYTES = readFileSync(FONT_PATH);
const FONT_BUFFER = FONT_BYTES.buffer.slice(
  FONT_BYTES.byteOffset,
  FONT_BYTES.byteOffset + FONT_BYTES.byteLength,
) as ArrayBuffer;

let font: Font;

beforeAll(() => {
  font = parseMontserratBlack(FONT_BUFFER);
});

describe('Montserrat Black asset', () => {
  it('loads the committed WOFF1 through opentype.js without a fallback', async () => {
    let requestedUrl = '';
    const loaded = await loadMontserratBlack(async (input) => {
      requestedUrl = input.toString();
      return new Response(FONT_BUFFER, { status: 200 });
    });

    expect(requestedUrl).toBe(FONT_ASSET_URL);
    expect((loaded.tables.os2 as unknown as { usWeightClass: number }).usWeightClass).toBe(900);
    expect(loaded.tables.fvar).toBeUndefined();
    expect(FONT_ASSET_SHA256).toHaveLength(64);
  });

  it('contains every character admitted by StoneBatch', () => {
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -') {
      expect(font.hasChar(character), character).toBe(true);
    }
  });
});

describe('physical scale', () => {
  it.each([35, 45, 55] as const)('uses H as the %d mm reference within 0.01 mm', (height) => {
    const geometry = createTextGeometry(font, 'H', height);

    expect(geometry.referenceHeightMm).toBeCloseTo(height, 2);
    expect(geometry.boundsMm?.height).toBeCloseTo(height, 2);
  });
});

describe('flattened contours', () => {
  it.each(['A', 'B', 'O', 'P', 'R'])('%s keeps at least one identifiable interior', (character) => {
    const [glyph] = createTextGeometry(font, character, 45).glyphs;

    expect(glyph.contours.filter((contour) => contour.role === 'exterior').length).toBeGreaterThan(0);
    expect(glyph.contours.filter((contour) => contour.role === 'interior').length).toBeGreaterThan(0);
    expect(glyph.contours.every((contour) => contour.points.length >= 3)).toBe(true);
  });

  it('keeps sampled curve deviation within the declared 0.025 mm tolerance', () => {
    const geometry = createTextGeometry(font, 'O', 45);
    const sourceCommands = font.charToGlyph('O').path.commands;
    const scale = geometry.scaleMmPerFontUnit;
    let contourIndex = -1;
    let start: PointMm | null = null;

    for (const command of sourceCommands) {
      if (command.type === 'M') {
        contourIndex += 1;
        start = scaledPoint(command.x, command.y, scale);
        continue;
      }

      if (command.type === 'L') {
        start = scaledPoint(command.x, command.y, scale);
        continue;
      }

      if (command.type === 'Z') {
        start = null;
        continue;
      }

      if (!start) throw new Error('Unexpected curve without a start point.');

      const contour = geometry.glyphs[0].contours[contourIndex].points;
      for (let step = 0; step <= 100; step += 1) {
        const point = evaluateCurve(command, start, step / 100, scale);
        expect(distanceToPolygon(point, contour)).toBeLessThanOrEqual(CURVE_TOLERANCE_MM + 0.000_001);
      }

      start = scaledPoint(command.x, command.y, scale);
    }
  });
});

describe('layout', () => {
  it('uses real kerning and adds exactly 1 mm between character advances', () => {
    const geometry = createTextGeometry(font, 'AV', 45);
    const [first, second] = geometry.glyphs;
    const unkernedSecondOrigin = first.originXmm + first.advanceMm + LETTER_SPACING_MM;

    expect(second.kerningBeforeMm).toBeLessThan(0);
    expect(second.originXmm).toBeCloseTo(unkernedSecondOrigin + second.kerningBeforeMm, 8);
    expect(second.originXmm).toBeLessThan(unkernedSecondOrigin);
  });

  it('preserves the natural space advance as well as inter-character spacing', () => {
    const geometry = createTextGeometry(font, 'A A', 45);
    const [first, space, last] = geometry.glyphs;

    expect(space.character).toBe(' ');
    expect(space.advanceMm).toBeGreaterThan(0);
    expect(space.contours).toEqual([]);
    expect(last.originXmm).toBeCloseTo(
      first.advanceMm + LETTER_SPACING_MM + space.advanceMm + LETTER_SPACING_MM,
      8,
    );
  });
});

describe('deterministic renderer-independent output', () => {
  it('returns identical coordinates, dimensions and segment order on repeated runs', () => {
    const first = createTextGeometry(font, 'HUGO 20', 55);
    const second = createTextGeometry(font, 'HUGO 20', 55);

    expect(second).toEqual(first);
  });

  it('does not change with viewport, zoom-like or devicePixelRatio globals', () => {
    const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
    const originalInnerWidth = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');

    try {
      Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 320 });
      const compact = createTextGeometry(font, 'HUGO', 45);

      Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 4 });
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 3840 });
      const dense = createTextGeometry(font, 'HUGO', 45);

      expect(dense).toEqual(compact);
    } finally {
      restoreGlobal('devicePixelRatio', originalDevicePixelRatio);
      restoreGlobal('innerWidth', originalInnerWidth);
    }
  });
});

function evaluateCurve(command: Extract<PathCommand, { type: 'Q' | 'C' }>, start: PointMm, t: number, scale: number): PointMm {
  const end = scaledPoint(command.x, command.y, scale);
  const oneMinusT = 1 - t;

  if (command.type === 'Q') {
    const control = scaledPoint(command.x1, command.y1, scale);
    return {
      x: oneMinusT ** 2 * start.x + 2 * oneMinusT * t * control.x + t ** 2 * end.x,
      y: oneMinusT ** 2 * start.y + 2 * oneMinusT * t * control.y + t ** 2 * end.y,
    };
  }

  const control1 = scaledPoint(command.x1, command.y1, scale);
  const control2 = scaledPoint(command.x2, command.y2, scale);
  return {
    x: oneMinusT ** 3 * start.x
      + 3 * oneMinusT ** 2 * t * control1.x
      + 3 * oneMinusT * t ** 2 * control2.x
      + t ** 3 * end.x,
    y: oneMinusT ** 3 * start.y
      + 3 * oneMinusT ** 2 * t * control1.y
      + 3 * oneMinusT * t ** 2 * control2.y
      + t ** 3 * end.y,
  };
}

function scaledPoint(x: number, y: number, scale: number): PointMm {
  return { x: x * scale, y: y * scale };
}

function distanceToPolygon(point: PointMm, polygon: PointMm[]): number {
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }

  return minimum;
}

function distanceToSegment(point: PointMm, start: PointMm, end: PointMm): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
