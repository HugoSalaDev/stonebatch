import { readFileSync } from 'node:fs';

import type { Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createTextGeometry,
  parseMontserratBlack,
  type FlattenedContour,
  type PointMm,
  type TextGeometry,
} from '../src/lib/engine/font-outlines';
import {
  ALLOWED_DIAMETERS_MM,
  GRID_ORIGIN_MM,
  INTERIOR_MARGIN_MM,
  MAX_CIRCLES_PER_BATCH,
  MAX_CIRCLES_PER_ROW,
  MAX_DESIGN_WIDTH_MM,
  MIN_EDGE_GAP_MM,
  RHINESTONE_ENGINE_VERSION,
  generateRhinestoneBatch,
  generateRhinestoneRow,
  preflightComplexity,
  type DiameterMm,
  type RhinestoneCircle,
  type RhinestoneRowResult,
} from '../src/lib/engine/rhinestone-grid';

const FONT_PATH = new URL('../public/fonts/montserrat-black-900-v25.woff', import.meta.url);
const FONT_BYTES = readFileSync(FONT_PATH);
const FONT_BUFFER = FONT_BYTES.buffer.slice(
  FONT_BYTES.byteOffset,
  FONT_BYTES.byteOffset + FONT_BYTES.byteLength,
) as ArrayBuffer;
const MATRIX_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

let font: Font;

beforeAll(() => {
  font = parseMontserratBlack(FONT_BUFFER);
});

describe('hexagonal rhinestone grid', () => {
  it.each(ALLOWED_DIAMETERS_MM)('uses exactly the selected %s mm diameter', (diameter) => {
    const result = generateRhinestoneRow(createTextGeometry(font, 'HUGO', 45), diameter);

    expect(result.circles.length).toBeGreaterThan(0);
    expect(result.circles.every((circle) => circle.diameterMm === diameter)).toBe(true);
  });

  it('keeps every pair of centers at least diameter + 0.6 mm apart', () => {
    const diameter = 3.2;
    const result = generateRhinestoneRow(createTextGeometry(font, 'HUGO', 45), diameter);
    const minimumDistance = diameter + MIN_EDGE_GAP_MM;
    let observedMinimum = Number.POSITIVE_INFINITY;

    expect(result.horizontalSpacingMm).toBeCloseTo(minimumDistance, 9);
    expect(result.verticalSpacingMm).toBeCloseTo(minimumDistance * Math.sqrt(3) / 2, 9);

    for (let first = 0; first < result.circles.length; first += 1) {
      for (let second = first + 1; second < result.circles.length; second += 1) {
        const distance = Math.hypot(
          result.circles[first].x - result.circles[second].x,
          result.circles[first].y - result.circles[second].y,
        );
        observedMinimum = Math.min(observedMinimum, distance);
        expect(distance).toBeGreaterThanOrEqual(minimumDistance - 0.01);
      }
    }

    expect(observedMinimum).toBeCloseTo(minimumDistance, 6);
  });

  it('keeps every accepted circle inside the filled region with the 0.05 mm margin', () => {
    const geometry = createTextGeometry(font, 'HUGO', 45);
    const result = generateRhinestoneRow(geometry, 3.2);

    assertIndependentContainment(result, geometry);
  });

  it.each(['A', 'B', 'O', 'P', 'R'])('never places circles inside the interior contours of %s', (character) => {
    const geometry = createTextGeometry(font, character, 55);
    const result = generateRhinestoneRow(geometry, 3);

    expect(findEnclosedHoleProbe(geometry.glyphs[0].contours)).not.toBeNull();
    for (const circle of result.circles) {
      expect(totalWinding(circle, geometry.glyphs[0].contours)).not.toBe(0);
    }
    assertIndependentContainment(result, geometry);
  });

  it('uses the fixed versioned origin and returns deterministic coordinates and counts', () => {
    const geometry = createTextGeometry(font, 'HUGO 20', 55);
    const first = generateRhinestoneRow(geometry, 3.2);
    const second = generateRhinestoneRow(geometry, 3.2);

    expect(RHINESTONE_ENGINE_VERSION).toBe('stonebatch-grid-v1');
    expect(GRID_ORIGIN_MM).toEqual({ x: 0, y: 0 });
    expect(first).toEqual(second);
  });

  it('is independent of viewport and devicePixelRatio globals', () => {
    const geometry = createTextGeometry(font, 'STONE', 45);
    const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
    const originalInnerWidth = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');

    try {
      Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 320 });
      const compact = generateRhinestoneRow(geometry, 3.4);

      Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 4 });
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 3840 });
      const dense = generateRhinestoneRow(geometry, 3.4);

      expect(dense).toEqual(compact);
    } finally {
      restoreGlobal('devicePixelRatio', originalDevicePixelRatio);
      restoreGlobal('innerWidth', originalInnerWidth);
    }
  });

  it('keeps the selected diameter unchanged at 35, 45 and 55 mm nominal heights', () => {
    const diameter = 3.6;

    for (const height of [35, 45, 55] as const) {
      const result = generateRhinestoneRow(createTextGeometry(font, 'H', height), diameter);
      expect(result.nominalHeightMm).toBe(height);
      expect(result.diameterMm).toBe(diameter);
      expect(result.circles.every((circle) => circle.diameterMm === diameter)).toBe(true);
    }
  });

  it('reports per-glyph and row counts and the real circle bounds', () => {
    const result = generateRhinestoneRow(createTextGeometry(font, 'A A', 45), 3.2);
    const independentlyMeasured = measureCircleBounds(result.circles, result.diameterMm);

    expect(result.glyphs[1]).toMatchObject({ character: ' ', circleCount: 0, circles: [] });
    expect(result.glyphs.reduce((total, glyph) => total + glyph.circleCount, 0)).toBe(result.circleCount);
    expect(result.boundsMm).toEqual(independentlyMeasured);
    expect(result.valid).toBe(true);
  });
});

describe('geometric preflight', () => {
  it('invalidates a visible glyph that receives no circle', () => {
    const result = generateRhinestoneRow(createTinyGeometry(), 3.6);

    expect(result.circleCount).toBe(0);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'GLYPH_WITHOUT_CIRCLES',
        character: 'X',
        glyphIndex: 0,
        row: 1,
      }),
    ]));
  });

  it('rejects a design wider than 270 mm without scaling its height or diameter', () => {
    const geometry = createTextGeometry(font, 'WWWW', 55);
    const result = generateRhinestoneRow(geometry, 3.2);

    expect(result.boundsMm?.width).toBeGreaterThan(MAX_DESIGN_WIDTH_MM);
    expect(result.valid).toBe(false);
    expect(result.nominalHeightMm).toBe(55);
    expect(result.diameterMm).toBe(3.2);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDTH_LIMIT_EXCEEDED' }),
    ]));
  });

  it('applies the exact 2,000 per-row and 20,000 per-batch boundaries', () => {
    const exactRow = preflightComplexity([MAX_CIRCLES_PER_ROW]);
    const overRow = preflightComplexity([MAX_CIRCLES_PER_ROW + 1]);
    const exactBatch = preflightComplexity(Array.from({ length: 10 }, () => MAX_CIRCLES_PER_ROW));
    const overBatch = preflightComplexity([...Array.from({ length: 10 }, () => MAX_CIRCLES_PER_ROW), 1]);

    expect(exactRow.rowErrors).toEqual([]);
    expect(overRow.rowErrors).toEqual([
      expect.objectContaining({ code: 'ROW_CIRCLE_LIMIT_EXCEEDED', row: 1 }),
    ]);
    expect(exactBatch.totalCircleCount).toBe(MAX_CIRCLES_PER_BATCH);
    expect(exactBatch.batchErrors).toEqual([]);
    expect(overBatch.totalCircleCount).toBe(MAX_CIRCLES_PER_BATCH + 1);
    expect(overBatch.batchErrors).toEqual([
      expect.objectContaining({ code: 'BATCH_CIRCLE_LIMIT_EXCEEDED' }),
    ]);
  });

  it('aggregates row counts and validity for a batch', () => {
    const geometries = [
      createTextGeometry(font, 'ANNA', 35),
      createTextGeometry(font, 'HUGO', 45),
    ];
    const result = generateRhinestoneBatch(geometries, 3.2);

    expect(result.totalCircleCount).toBe(result.rows.reduce((total, row) => total + row.circleCount, 0));
    expect(result.valid).toBe(result.rows.every((row) => row.valid));
  });
});

describe('A-Z, 0-9 and hyphen matrix', () => {
  it('preflights all 444 character, height and diameter combinations', () => {
    const combinations: Array<{
      character: string;
      height: 35 | 45 | 55;
      diameter: DiameterMm;
      result: RhinestoneRowResult;
    }> = [];

    for (const character of MATRIX_CHARACTERS) {
      for (const height of [35, 45, 55] as const) {
        const geometry = createTextGeometry(font, character, height);
        for (const diameter of ALLOWED_DIAMETERS_MM) {
          const result = generateRhinestoneRow(geometry, diameter);
          combinations.push({ character, height, diameter, result });

          expect(result.circles.every((circle) => circle.diameterMm === diameter)).toBe(true);
          if (result.valid) {
            expect(result.circleCount).toBeGreaterThan(0);
            assertIndependentContainment(result, geometry);
          } else {
            expect(result.errors.length).toBeGreaterThan(0);
          }
        }
      }
    }

    const invalidCombinations = combinations
      .filter(({ result }) => !result.valid)
      .map(({ character, height, diameter, result }) => ({
        character,
        height,
        diameter,
        errors: result.errors.map((error) => error.code),
      }));

    expect(combinations).toHaveLength(37 * 3 * 4);
    expect(invalidCombinations).toEqual([]);
  });
});

function assertIndependentContainment(result: RhinestoneRowResult, geometry: TextGeometry): void {
  const requiredDistance = result.diameterMm / 2 + INTERIOR_MARGIN_MM;

  for (const circle of result.circles) {
    const glyph = geometry.glyphs[circle.glyphIndex];
    const minimumBoundaryDistance = minimumDistanceToContours(circle, glyph.contours);

    expect(totalWinding(circle, glyph.contours)).not.toBe(0);
    expect(minimumBoundaryDistance).toBeGreaterThanOrEqual(requiredDistance - 0.000_001);
  }
}

function totalWinding(point: PointMm, contours: readonly FlattenedContour[]): number {
  return contours.reduce((total, contour) => total + windingNumber(point, contour.points), 0);
}

function findEnclosedHoleProbe(contours: readonly FlattenedContour[]): PointMm | null {
  const points = contours.flatMap((contour) => contour.points);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const segments = contours.flatMap((contour) => contour.points.map((start, index) => ({
    start,
    end: contour.points[(index + 1) % contour.points.length],
  })));

  for (let yStep = 1; yStep < 80; yStep += 1) {
    for (let xStep = 1; xStep < 80; xStep += 1) {
      const point = {
        x: minX + (maxX - minX) * xStep / 80,
        y: minY + (maxY - minY) * yStep / 80,
      };

      if (totalWinding(point, contours) !== 0 || minimumDistanceToContours(point, contours) < 0.1) {
        continue;
      }

      const hasLeft = segments.some(({ start, end }) => horizontalIntersectionX(point.y, start, end) < point.x);
      const hasRight = segments.some(({ start, end }) => horizontalIntersectionX(point.y, start, end) > point.x);
      const hasBelow = segments.some(({ start, end }) => verticalIntersectionY(point.x, start, end) < point.y);
      const hasAbove = segments.some(({ start, end }) => verticalIntersectionY(point.x, start, end) > point.y);

      if (hasLeft && hasRight && hasBelow && hasAbove) return point;
    }
  }

  return null;
}

function horizontalIntersectionX(y: number, start: PointMm, end: PointMm): number {
  if ((start.y > y) === (end.y > y) || start.y === end.y) return Number.NaN;
  return start.x + (y - start.y) * (end.x - start.x) / (end.y - start.y);
}

function verticalIntersectionY(x: number, start: PointMm, end: PointMm): number {
  if ((start.x > x) === (end.x > x) || start.x === end.x) return Number.NaN;
  return start.y + (x - start.x) * (end.y - start.y) / (end.x - start.x);
}

function windingNumber(point: PointMm, polygon: readonly PointMm[]): number {
  let winding = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const side = (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y);

    if (start.y <= point.y && end.y > point.y && side > 0) winding += 1;
    if (start.y > point.y && end.y <= point.y && side < 0) winding -= 1;
  }

  return winding;
}

function minimumDistanceToContours(point: PointMm, contours: readonly FlattenedContour[]): number {
  let minimum = Number.POSITIVE_INFINITY;

  for (const contour of contours) {
    for (let index = 0; index < contour.points.length; index += 1) {
      minimum = Math.min(
        minimum,
        distanceToSegment(point, contour.points[index], contour.points[(index + 1) % contour.points.length]),
      );
    }
  }

  return minimum;
}

function distanceToSegment(point: PointMm, start: PointMm, end: PointMm): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

function measureCircleBounds(circles: readonly RhinestoneCircle[], diameterMm: DiameterMm) {
  const radius = diameterMm / 2;
  const minX = Math.min(...circles.map((circle) => circle.x)) - radius;
  const minY = Math.min(...circles.map((circle) => circle.y)) - radius;
  const maxX = Math.max(...circles.map((circle) => circle.x)) + radius;
  const maxY = Math.max(...circles.map((circle) => circle.y)) + radius;

  return {
    minX: round(minX),
    minY: round(minY),
    maxX: round(maxX),
    maxY: round(maxY),
    width: round(maxX - minX),
    height: round(maxY - minY),
  };
}

function createTinyGeometry(): TextGeometry {
  const contour: FlattenedContour = {
    role: 'exterior',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    signedAreaMm2: 1,
  };

  return {
    text: 'X',
    nominalHeightMm: 35,
    referenceHeightMm: 35,
    scaleMmPerFontUnit: 0.05,
    curveToleranceMm: 0.025,
    letterSpacingMm: 1,
    advanceWidthMm: 1,
    boundsMm: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
    glyphs: [{
      character: 'X',
      index: 0,
      glyphIndex: 1,
      originXmm: 0,
      kerningBeforeMm: 0,
      advanceMm: 1,
      contours: [contour],
    }],
  };
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

function round(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
