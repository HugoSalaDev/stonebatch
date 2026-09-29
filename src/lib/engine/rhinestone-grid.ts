import {
  FONT_ASSET_SHA256,
  type BoundsMm,
  type FlattenedContour,
  type GlyphGeometry,
  type PointMm,
  type TextGeometry,
} from './font-outlines';

export const RHINESTONE_ENGINE_VERSION = 'stonebatch-grid-v1';
export const GRID_ORIGIN_MM = Object.freeze({ x: 0, y: 0 });
export const ALLOWED_DIAMETERS_MM = [3, 3.2, 3.4, 3.6] as const;
export const MIN_EDGE_GAP_MM = 0.6;
export const INTERIOR_MARGIN_MM = 0.05;
export const MAX_DESIGN_WIDTH_MM = 270;
export const MAX_CIRCLES_PER_ROW = 2_000;
export const MAX_CIRCLES_PER_BATCH = 20_000;

const COORDINATE_PRECISION = 1_000_000_000;

export type DiameterMm = (typeof ALLOWED_DIAMETERS_MM)[number];
export type RhinestoneErrorCode =
  | 'GLYPH_WITHOUT_CIRCLES'
  | 'WIDTH_LIMIT_EXCEEDED'
  | 'ROW_CIRCLE_LIMIT_EXCEEDED'
  | 'BATCH_CIRCLE_LIMIT_EXCEEDED';

export interface RhinestoneError {
  code: RhinestoneErrorCode;
  message: string;
  row?: number;
  glyphIndex?: number;
  character?: string;
}

export interface RhinestoneCircle extends PointMm {
  diameterMm: DiameterMm;
  glyphIndex: number;
}

export interface GlyphRhinestoneResult {
  character: string;
  glyphIndex: number;
  circleCount: number;
  circles: RhinestoneCircle[];
}

export interface RhinestoneRowResult {
  text: string;
  nominalHeightMm: TextGeometry['nominalHeightMm'];
  diameterMm: DiameterMm;
  engineVersion: typeof RHINESTONE_ENGINE_VERSION;
  fontAssetSha256: typeof FONT_ASSET_SHA256;
  gridOriginMm: PointMm;
  horizontalSpacingMm: number;
  verticalSpacingMm: number;
  circleCount: number;
  circles: RhinestoneCircle[];
  glyphs: GlyphRhinestoneResult[];
  boundsMm: BoundsMm | null;
  valid: boolean;
  errors: RhinestoneError[];
}

export interface RhinestoneBatchResult {
  engineVersion: typeof RHINESTONE_ENGINE_VERSION;
  diameterMm: DiameterMm;
  totalCircleCount: number;
  rows: RhinestoneRowResult[];
  valid: boolean;
  errors: RhinestoneError[];
}

export interface ComplexityPreflight {
  totalCircleCount: number;
  rowErrors: RhinestoneError[];
  batchErrors: RhinestoneError[];
}

export function generateRhinestoneRow(
  geometry: TextGeometry,
  diameterMm: DiameterMm,
  row = 1,
): RhinestoneRowResult {
  assertDiameter(diameterMm);

  const horizontalSpacingMm = diameterMm + MIN_EDGE_GAP_MM;
  const verticalSpacingMm = horizontalSpacingMm * Math.sqrt(3) / 2;
  const usedCoordinates = new Set<string>();
  const glyphResults: GlyphRhinestoneResult[] = [];

  for (const glyph of geometry.glyphs) {
    const circles = glyph.character === ' '
      ? []
      : generateGlyphCircles(
          glyph,
          diameterMm,
          horizontalSpacingMm,
          verticalSpacingMm,
          usedCoordinates,
        );

    glyphResults.push({
      character: glyph.character,
      glyphIndex: glyph.index,
      circleCount: circles.length,
      circles,
    });
  }

  const circles = glyphResults.flatMap((glyph) => glyph.circles);
  const boundsMm = getCircleBounds(circles, diameterMm);
  const errors: RhinestoneError[] = [];

  for (const glyph of glyphResults) {
    if (glyph.character !== ' ' && glyph.circleCount === 0) {
      errors.push({
        code: 'GLYPH_WITHOUT_CIRCLES',
        message: `Character ${JSON.stringify(glyph.character)} at position ${glyph.glyphIndex + 1} has no valid circles.`,
        row,
        glyphIndex: glyph.glyphIndex,
        character: glyph.character,
      });
    }
  }

  if (boundsMm && boundsMm.width > MAX_DESIGN_WIDTH_MM) {
    errors.push({
      code: 'WIDTH_LIMIT_EXCEEDED',
      message: `Design width ${formatMillimeters(boundsMm.width)} mm exceeds the ${MAX_DESIGN_WIDTH_MM} mm limit.`,
      row,
    });
  }

  const complexity = preflightComplexity([circles.length]);
  errors.push(...complexity.rowErrors.map((error) => ({
    ...error,
    message: `Row ${row} contains ${circles.length} circles and exceeds the ${MAX_CIRCLES_PER_ROW} circle limit.`,
    row,
  })));

  return {
    text: geometry.text,
    nominalHeightMm: geometry.nominalHeightMm,
    diameterMm,
    engineVersion: RHINESTONE_ENGINE_VERSION,
    fontAssetSha256: FONT_ASSET_SHA256,
    gridOriginMm: { ...GRID_ORIGIN_MM },
    horizontalSpacingMm: roundCoordinate(horizontalSpacingMm),
    verticalSpacingMm: roundCoordinate(verticalSpacingMm),
    circleCount: circles.length,
    circles,
    glyphs: glyphResults,
    boundsMm,
    valid: errors.length === 0,
    errors,
  };
}

export function generateRhinestoneBatch(
  geometries: readonly TextGeometry[],
  diameterMm: DiameterMm,
): RhinestoneBatchResult {
  const rows = geometries.map((geometry, index) => generateRhinestoneRow(geometry, diameterMm, index + 1));
  const complexity = preflightComplexity(rows.map((row) => row.circleCount));
  const errors = complexity.batchErrors;

  return {
    engineVersion: RHINESTONE_ENGINE_VERSION,
    diameterMm,
    totalCircleCount: complexity.totalCircleCount,
    rows,
    valid: errors.length === 0 && rows.every((row) => row.valid),
    errors,
  };
}

export function preflightComplexity(rowCircleCounts: readonly number[]): ComplexityPreflight {
  const rowErrors = rowCircleCounts.flatMap((circleCount, index): RhinestoneError[] => {
    if (circleCount <= MAX_CIRCLES_PER_ROW) return [];

    return [{
      code: 'ROW_CIRCLE_LIMIT_EXCEEDED',
      message: `Row ${index + 1} contains ${circleCount} circles and exceeds the ${MAX_CIRCLES_PER_ROW} circle limit.`,
      row: index + 1,
    }];
  });
  const totalCircleCount = rowCircleCounts.reduce((total, count) => total + count, 0);
  const batchErrors: RhinestoneError[] = totalCircleCount > MAX_CIRCLES_PER_BATCH
    ? [{
        code: 'BATCH_CIRCLE_LIMIT_EXCEEDED',
        message: `Batch contains ${totalCircleCount} circles and exceeds the ${MAX_CIRCLES_PER_BATCH} circle limit.`,
      }]
    : [];

  return { totalCircleCount, rowErrors, batchErrors };
}

function generateGlyphCircles(
  glyph: GlyphGeometry,
  diameterMm: DiameterMm,
  horizontalSpacingMm: number,
  verticalSpacingMm: number,
  usedCoordinates: Set<string>,
): RhinestoneCircle[] {
  const bounds = getContourBounds(glyph.contours);
  if (!bounds) return [];

  const requiredClearanceMm = diameterMm / 2 + INTERIOR_MARGIN_MM;
  const minimumRow = Math.ceil((bounds.minY + requiredClearanceMm - GRID_ORIGIN_MM.y) / verticalSpacingMm);
  const maximumRow = Math.floor((bounds.maxY - requiredClearanceMm - GRID_ORIGIN_MM.y) / verticalSpacingMm);
  const circles: RhinestoneCircle[] = [];

  for (let row = minimumRow; row <= maximumRow; row += 1) {
    const y = roundCoordinate(GRID_ORIGIN_MM.y + row * verticalSpacingMm);
    const offsetX = row % 2 === 0 ? 0 : horizontalSpacingMm / 2;
    const minimumColumn = Math.ceil(
      (bounds.minX + requiredClearanceMm - GRID_ORIGIN_MM.x - offsetX) / horizontalSpacingMm,
    );
    const maximumColumn = Math.floor(
      (bounds.maxX - requiredClearanceMm - GRID_ORIGIN_MM.x - offsetX) / horizontalSpacingMm,
    );

    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      const point = {
        x: roundCoordinate(GRID_ORIGIN_MM.x + offsetX + column * horizontalSpacingMm),
        y,
      };
      const coordinateKey = `${point.x.toFixed(9)},${point.y.toFixed(9)}`;

      if (usedCoordinates.has(coordinateKey) || !circleFitsGlyph(point, glyph.contours, requiredClearanceMm)) {
        continue;
      }

      usedCoordinates.add(coordinateKey);
      circles.push({ ...point, diameterMm, glyphIndex: glyph.index });
    }
  }

  return circles;
}

function circleFitsGlyph(
  center: PointMm,
  contours: readonly FlattenedContour[],
  requiredClearanceMm: number,
): boolean {
  const winding = contours.reduce((total, contour) => total + windingNumber(center, contour.points), 0);
  if (winding === 0) return false;

  for (const contour of contours) {
    for (let index = 0; index < contour.points.length; index += 1) {
      const start = contour.points[index];
      const end = contour.points[(index + 1) % contour.points.length];
      if (distanceToSegment(center, start, end) < requiredClearanceMm) {
        return false;
      }
    }
  }

  return true;
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

function distanceToSegment(point: PointMm, start: PointMm, end: PointMm): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const closestX = start.x + projection * dx;
  const closestY = start.y + projection * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function getContourBounds(contours: readonly FlattenedContour[]): BoundsMm | null {
  const points = contours.flatMap((contour) => contour.points);
  return getPointBounds(points);
}

function getCircleBounds(circles: readonly RhinestoneCircle[], diameterMm: DiameterMm): BoundsMm | null {
  if (circles.length === 0) return null;

  const centerBounds = getPointBounds(circles);
  if (!centerBounds) return null;
  const radius = diameterMm / 2;
  const minX = centerBounds.minX - radius;
  const minY = centerBounds.minY - radius;
  const maxX = centerBounds.maxX + radius;
  const maxY = centerBounds.maxY + radius;

  return {
    minX: roundCoordinate(minX),
    minY: roundCoordinate(minY),
    maxX: roundCoordinate(maxX),
    maxY: roundCoordinate(maxY),
    width: roundCoordinate(maxX - minX),
    height: roundCoordinate(maxY - minY),
  };
}

function getPointBounds(points: readonly PointMm[]): BoundsMm | null {
  if (points.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX: roundCoordinate(minX),
    minY: roundCoordinate(minY),
    maxX: roundCoordinate(maxX),
    maxY: roundCoordinate(maxY),
    width: roundCoordinate(maxX - minX),
    height: roundCoordinate(maxY - minY),
  };
}

function assertDiameter(diameterMm: number): asserts diameterMm is DiameterMm {
  if (!(ALLOWED_DIAMETERS_MM as readonly number[]).includes(diameterMm)) {
    throw new Error(`Unsupported rhinestone diameter: ${diameterMm} mm.`);
  }
}

function formatMillimeters(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function roundCoordinate(value: number): number {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}
