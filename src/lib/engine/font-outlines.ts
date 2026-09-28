import opentype, { type Font, type Glyph, type PathCommand } from 'opentype.js';

export const FONT_ASSET_URL = '/fonts/montserrat-black-900-v25.woff';
export const FONT_ASSET_SHA256 = 'de684d0fc8ec2528aebf54b710da0ed924dc5faf3a488d37fad82c8e23ac3fec';
export const CURVE_TOLERANCE_MM = 0.025;
export const LETTER_SPACING_MM = 1;
export const NOMINAL_HEIGHTS_MM = [35, 45, 55] as const;

const SUPPORTED_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -';
const SUPPORTED_TEXT = /^[A-Z0-9 -]+$/;
const COORDINATE_PRECISION = 1_000_000_000;
const MAX_SUBDIVISION_DEPTH = 32;

export type NominalHeightMm = (typeof NOMINAL_HEIGHTS_MM)[number];

export interface PointMm {
  x: number;
  y: number;
}

export interface BoundsMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface FlattenedContour {
  role: 'exterior' | 'interior';
  points: PointMm[];
  signedAreaMm2: number;
}

export interface GlyphGeometry {
  character: string;
  index: number;
  glyphIndex: number;
  originXmm: number;
  kerningBeforeMm: number;
  advanceMm: number;
  contours: FlattenedContour[];
}

export interface TextGeometry {
  text: string;
  nominalHeightMm: NominalHeightMm;
  referenceHeightMm: number;
  scaleMmPerFontUnit: number;
  curveToleranceMm: number;
  letterSpacingMm: number;
  advanceWidthMm: number;
  boundsMm: BoundsMm | null;
  glyphs: GlyphGeometry[];
}

type FontFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function parseMontserratBlack(buffer: ArrayBuffer): Font {
  const font = opentype.parse(buffer);
  const os2 = font.tables.os2 as { fsSelection?: number; usWeightClass?: number } | undefined;
  const head = font.tables.head as { macStyle?: number } | undefined;
  const isItalic = Boolean((os2?.fsSelection ?? 0) & 1) || Boolean((head?.macStyle ?? 0) & 2);

  if (font.tables.fvar || os2?.usWeightClass !== 900 || isItalic) {
    throw new Error('Expected the static Montserrat Black font at weight 900 and normal style.');
  }

  for (const character of SUPPORTED_CHARACTERS) {
    if (!font.hasChar(character)) {
      throw new Error(`Montserrat Black is missing the required character ${JSON.stringify(character)}.`);
    }
  }

  const referenceHeight = getReferenceHeightInFontUnits(font);
  if (referenceHeight <= 0) {
    throw new Error('Montserrat Black has an invalid H reference height.');
  }

  return font;
}

export async function loadMontserratBlack(fetcher: FontFetcher = fetch): Promise<Font> {
  const response = await fetcher(FONT_ASSET_URL);

  if (!response.ok) {
    throw new Error(`Unable to load Montserrat Black (${response.status} ${response.statusText}).`);
  }

  return parseMontserratBlack(await response.arrayBuffer());
}

export function createTextGeometry(
  font: Font,
  text: string,
  nominalHeightMm: NominalHeightMm,
): TextGeometry {
  if (!SUPPORTED_TEXT.test(text)) {
    throw new Error('Text must contain only A-Z, 0-9, spaces and hyphens.');
  }

  if (!NOMINAL_HEIGHTS_MM.includes(nominalHeightMm)) {
    throw new Error(`Unsupported nominal height: ${nominalHeightMm} mm.`);
  }

  const referenceHeightInFontUnits = getReferenceHeightInFontUnits(font);
  const scaleMmPerFontUnit = nominalHeightMm / referenceHeightInFontUnits;
  const characters = Array.from(text);
  const glyphs: GlyphGeometry[] = [];
  let penXmm = 0;
  let previousGlyph: Glyph | null = null;

  for (const [index, character] of characters.entries()) {
    const glyph = font.charToGlyph(character);
    if (glyph.index === 0) {
      throw new Error(`Montserrat Black has no glyph for ${JSON.stringify(character)}.`);
    }

    const kerningBeforeMm = previousGlyph
      ? font.getKerningValue(previousGlyph, glyph) * scaleMmPerFontUnit
      : 0;
    penXmm += kerningBeforeMm;

    const originXmm = penXmm;
    const advanceMm = requireAdvanceWidth(glyph, character) * scaleMmPerFontUnit;
    const contours = flattenGlyph(glyph, originXmm, scaleMmPerFontUnit);

    glyphs.push({
      character,
      index,
      glyphIndex: glyph.index,
      originXmm: roundCoordinate(originXmm),
      kerningBeforeMm: roundCoordinate(kerningBeforeMm),
      advanceMm: roundCoordinate(advanceMm),
      contours,
    });

    penXmm += advanceMm;
    if (index < characters.length - 1) {
      penXmm += LETTER_SPACING_MM;
    }
    previousGlyph = glyph;
  }

  return {
    text,
    nominalHeightMm,
    referenceHeightMm: roundCoordinate(referenceHeightInFontUnits * scaleMmPerFontUnit),
    scaleMmPerFontUnit,
    curveToleranceMm: CURVE_TOLERANCE_MM,
    letterSpacingMm: LETTER_SPACING_MM,
    advanceWidthMm: roundCoordinate(penXmm),
    boundsMm: getBounds(glyphs),
    glyphs,
  };
}

function getReferenceHeightInFontUnits(font: Font): number {
  const bounds = font.charToGlyph('H').getBoundingBox();
  return bounds.y2 - bounds.y1;
}

function requireAdvanceWidth(glyph: Glyph, character: string): number {
  if (glyph.advanceWidth === undefined) {
    throw new Error(`Montserrat Black has no advance width for ${JSON.stringify(character)}.`);
  }

  return glyph.advanceWidth;
}

function flattenGlyph(glyph: Glyph, originXmm: number, scaleMmPerFontUnit: number): FlattenedContour[] {
  const contours = flattenCommands(glyph.path.commands, originXmm, scaleMmPerFontUnit);

  return contours.map((points, contourIndex) => {
    const area = signedArea(points);
    const nestingDepth = contours.reduce((depth, candidate, candidateIndex) => {
      if (candidateIndex === contourIndex || Math.abs(signedArea(candidate)) <= Math.abs(area)) {
        return depth;
      }

      return pointInPolygon(points[0], candidate) ? depth + 1 : depth;
    }, 0);

    return {
      role: nestingDepth % 2 === 0 ? 'exterior' : 'interior',
      points,
      signedAreaMm2: roundCoordinate(area),
    };
  });
}

function flattenCommands(
  commands: PathCommand[],
  originXmm: number,
  scaleMmPerFontUnit: number,
): PointMm[][] {
  const contours: PointMm[][] = [];
  let points: PointMm[] = [];
  let current: PointMm | null = null;

  const transform = (x: number, y: number): PointMm => ({
    x: originXmm + x * scaleMmPerFontUnit,
    y: y * scaleMmPerFontUnit,
  });

  const finishContour = () => {
    if (points.length >= 3) {
      contours.push(points.map(roundPoint));
    }
    points = [];
  };

  for (const command of commands) {
    switch (command.type) {
      case 'M': {
        finishContour();
        current = transform(command.x, command.y);
        points = [current];
        break;
      }
      case 'L': {
        current = transform(command.x, command.y);
        appendDistinct(points, current);
        break;
      }
      case 'Q': {
        if (!current) throw new Error('Invalid quadratic path without a starting point.');
        const control = transform(command.x1, command.y1);
        const end = transform(command.x, command.y);
        flattenQuadratic(current, control, end, points, 0);
        current = end;
        break;
      }
      case 'C': {
        if (!current) throw new Error('Invalid cubic path without a starting point.');
        const control1 = transform(command.x1, command.y1);
        const control2 = transform(command.x2, command.y2);
        const end = transform(command.x, command.y);
        flattenCubic(current, control1, control2, end, points, 0);
        current = end;
        break;
      }
      case 'Z': {
        finishContour();
        current = null;
        break;
      }
    }
  }

  finishContour();
  return contours;
}

function flattenQuadratic(
  start: PointMm,
  control: PointMm,
  end: PointMm,
  output: PointMm[],
  depth: number,
): void {
  if (depth >= MAX_SUBDIVISION_DEPTH || distanceToLine(control, start, end) <= CURVE_TOLERANCE_MM) {
    appendDistinct(output, end);
    return;
  }

  const startControl = midpoint(start, control);
  const controlEnd = midpoint(control, end);
  const split = midpoint(startControl, controlEnd);
  flattenQuadratic(start, startControl, split, output, depth + 1);
  flattenQuadratic(split, controlEnd, end, output, depth + 1);
}

function flattenCubic(
  start: PointMm,
  control1: PointMm,
  control2: PointMm,
  end: PointMm,
  output: PointMm[],
  depth: number,
): void {
  const flatness = Math.max(
    distanceToLine(control1, start, end),
    distanceToLine(control2, start, end),
  );

  if (depth >= MAX_SUBDIVISION_DEPTH || flatness <= CURVE_TOLERANCE_MM) {
    appendDistinct(output, end);
    return;
  }

  const startControl1 = midpoint(start, control1);
  const control1Control2 = midpoint(control1, control2);
  const control2End = midpoint(control2, end);
  const firstMiddle = midpoint(startControl1, control1Control2);
  const secondMiddle = midpoint(control1Control2, control2End);
  const split = midpoint(firstMiddle, secondMiddle);

  flattenCubic(start, startControl1, firstMiddle, split, output, depth + 1);
  flattenCubic(split, secondMiddle, control2End, end, output, depth + 1);
}

function distanceToLine(point: PointMm, start: PointMm, end: PointMm): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function midpoint(first: PointMm, second: PointMm): PointMm {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function appendDistinct(points: PointMm[], point: PointMm): void {
  const last = points.at(-1);
  if (!last || last.x !== point.x || last.y !== point.y) {
    points.push(point);
  }
}

function signedArea(points: PointMm[]): number {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function pointInPolygon(point: PointMm, polygon: PointMm[]): boolean {
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex++) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crossesRay = (current.y > point.y) !== (previous.y > point.y)
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;

    if (crossesRay) inside = !inside;
  }

  return inside;
}

function getBounds(glyphs: GlyphGeometry[]): BoundsMm | null {
  const points = glyphs.flatMap((glyph) => glyph.contours.flatMap((contour) => contour.points));
  if (points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    minX: roundCoordinate(minX),
    minY: roundCoordinate(minY),
    maxX: roundCoordinate(maxX),
    maxY: roundCoordinate(maxY),
    width: roundCoordinate(maxX - minX),
    height: roundCoordinate(maxY - minY),
  };
}

function roundPoint(point: PointMm): PointMm {
  return {
    x: roundCoordinate(point.x),
    y: roundCoordinate(point.y),
  };
}

function roundCoordinate(value: number): number {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}
