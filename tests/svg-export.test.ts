import { readFileSync } from 'node:fs';

import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import type { Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createTextGeometry, parseMontserratBlack } from '../src/lib/engine/font-outlines';
import { ALLOWED_DIAMETERS_MM, MIN_EDGE_GAP_MM, generateRhinestoneRow } from '../src/lib/engine/rhinestone-grid';
import {
  CALIBRATION_GRID_COLUMNS,
  CALIBRATION_GRID_ROWS,
  CALIBRATION_INSTRUCTIONS,
  SVG_EXPORT_VERSION,
  createCalibrationCoupons,
  createSvgFilename,
  exportRowSvg,
  exportRowsSvg,
} from '../src/lib/export/svg-export';

const FONT_PATH = new URL('../public/fonts/montserrat-black-900-v25.woff', import.meta.url);
const FONT_BYTES = readFileSync(FONT_PATH);
const FONT_BUFFER = FONT_BYTES.buffer.slice(
  FONT_BYTES.byteOffset,
  FONT_BYTES.byteOffset + FONT_BYTES.byteLength,
) as ArrayBuffer;
const TOLERANCE_MM = 0.01;

let font: Font;

beforeAll(() => {
  font = parseMontserratBlack(FONT_BUFFER);
});

describe('individual SVG export', () => {
  it('serializes exactly the T04 circles, dimensions and real-circle bounds for ANNA', () => {
    const row = generateRhinestoneRow(createTextGeometry(font, 'ANNA', 45), 3.2);
    const exported = exportRowSvg(row, 1);
    const parsed = parseSvg(exported.svg);

    expect(exported.filename).toBe('01-ANNA-h45-d3p2.svg');
    expect(exported.circleCount).toBe(row.circleCount);
    expect(parsed.circles).toHaveLength(row.circleCount);
    expect(parsed.widthMm).toBeCloseTo(row.boundsMm?.width ?? 0, 2);
    expect(parsed.heightMm).toBeCloseTo(row.boundsMm?.height ?? 0, 2);
    expect(parsed.viewBox).toEqual([0, 0, parsed.widthMm, parsed.heightMm]);
    expect(measureCircleBounds(parsed.circles)).toMatchObject({
      minX: expect.closeTo(0, 2),
      minY: expect.closeTo(0, 2),
      maxX: expect.closeTo(parsed.widthMm, 2),
      maxY: expect.closeTo(parsed.heightMm, 2),
    });
    expect(exported.translationMm).toEqual({
      x: -(row.boundsMm?.minX ?? 0),
      y: -(row.boundsMm?.minY ?? 0),
    });
  });

  it.each([35, 45, 55] as const)('preserves physical dimensions at %s mm', (height) => {
    const row = generateRhinestoneRow(createTextGeometry(font, 'A-1', height), 3.4);
    const exported = exportRowSvg(row, 1);
    const parsed = parseSvg(exported.svg);

    expect(exported.nominalHeightMm).toBe(height);
    expect(parsed.widthMm).toBeCloseTo(exported.widthMm, 2);
    expect(parsed.heightMm).toBeCloseTo(exported.heightMm, 2);
    expect(parsed.circles).toHaveLength(exported.circleCount);
  });

  it.each(ALLOWED_DIAMETERS_MM)('keeps radius exact for the selected %s mm diameter', (diameter) => {
    const row = generateRhinestoneRow(createTextGeometry(font, 'A-1', 45), diameter);
    const exported = exportRowSvg(row, 1);
    const parsed = parseSvg(exported.svg);

    expect(parsed.circles.every((circle) => circle.r === diameter / 2)).toBe(true);
    expect(exported.diameterMm).toBe(diameter);
  });

  it('contains one design group and no active, external or non-circle design content', () => {
    const row = generateRhinestoneRow(createTextGeometry(font, 'ANNA', 45), 3.2);
    const parsed = parseSvg(exportRowSvg(row, 1).svg);
    const root = parsed.document.documentElement;
    if (!root) throw new Error('SVG parser returned no root element.');

    expect(parsed.document.getElementsByTagName('g')).toHaveLength(1);
    for (const forbiddenTag of ['text', 'script', 'image', 'foreignObject', 'mask', 'filter', 'rect']) {
      expect(parsed.document.getElementsByTagName(forbiddenTag)).toHaveLength(0);
    }
    expect(parsed.document.getElementsByTagName('circle')).toHaveLength(row.circleCount);
    expect(parsed.circles.every((circle) => circle.fill === 'black')).toBe(true);
    expect(getElementNames(root)).toEqual(expect.arrayContaining(['svg', 'g', 'circle']));
    expect(getElementNames(root).every((name) => ['svg', 'g', 'circle'].includes(name))).toBe(true);
    expect(hasAttribute(root, 'stroke')).toBe(false);
    expect(parsed.svg).not.toContain('stroke=');
    expect(parsed.svg).not.toContain('href=');
    expect(parsed.svg).not.toContain('url(');
  });

  it('keeps duplicate rows distinct by index and uses the exact filename pattern', () => {
    const duplicate = generateRhinestoneRow(createTextGeometry(font, 'ANNA', 45), 3.2);
    const files = exportRowsSvg([duplicate, duplicate]);

    expect(files.map((file) => file.filename)).toEqual([
      '01-ANNA-h45-d3p2.svg',
      '02-ANNA-h45-d3p2.svg',
    ]);
    expect(createSvgFilename(1, 'A-1', 35, 3)).toBe('01-A-1-h35-d3p0.svg');
  });

  it('is deterministic for the same valid T04 row', () => {
    const row = generateRhinestoneRow(createTextGeometry(font, 'ANNA', 55), 3.6);

    expect(exportRowSvg(row, 1)).toEqual(exportRowSvg(row, 1));
    expect(exportRowSvg(row, 1).exportVersion).toBe(SVG_EXPORT_VERSION);
  });
});

describe('5×5 calibration coupons', () => {
  it('creates exactly one clean 25-circle coupon for each permitted diameter', () => {
    const coupons = createCalibrationCoupons();

    expect(coupons.map((coupon) => coupon.diameterMm)).toEqual(ALLOWED_DIAMETERS_MM);
    expect(coupons).toHaveLength(4);

    for (const coupon of coupons) {
      const parsed = parseSvg(coupon.svg);
      expect(coupon.filename).toBe(`stonebatch-calibration-d${coupon.diameterMm.toFixed(1).replace('.', 'p')}.svg`);
      expect(coupon.circleCount).toBe(CALIBRATION_GRID_ROWS * CALIBRATION_GRID_COLUMNS);
      expect(parsed.circles).toHaveLength(25);
      expect(parsed.circles.every((circle) => circle.r === coupon.diameterMm / 2)).toBe(true);
      expect(parsed.widthMm).toBeCloseTo(coupon.widthMm, 2);
      expect(parsed.heightMm).toBeCloseTo(coupon.heightMm, 2);
      expect(parsed.document.getElementsByTagName('text')).toHaveLength(0);
      expect(parsed.document.getElementsByTagName('rect')).toHaveLength(0);
      expect(parsed.document.getElementsByTagName('g')).toHaveLength(1);
      expectMinimumCenterDistance(parsed.circles, coupon.diameterMm + MIN_EDGE_GAP_MM);
    }
  });

  it('returns reusable calibration and Cricut instructions without cut text in the SVGs', () => {
    expect(CALIBRATION_INSTRUCTIONS.calibration.join(' ')).toContain('SS10');
    expect(CALIBRATION_INSTRUCTIONS.calibration.join(' ')).toContain('your own material');
    expect(CALIBRATION_INSTRUCTIONS.calibration.join(' ')).toContain('which hole diameter fits your rhinestones best');
    expect(CALIBRATION_INSTRUCTIONS.calibration.join(' ')).toContain('universal pressure, blade, or material setting');
    expect(CALIBRATION_INSTRUCTIONS.cricut.join(' ')).toContain('Import the SVG as a cut');
    expect(CALIBRATION_INSTRUCTIONS.cricut.join(' ')).toContain('Verify the width and height');
    expect(CALIBRATION_INSTRUCTIONS.cricut.join(' ')).toContain('Select all design elements');
    expect(CALIBRATION_INSTRUCTIONS.cricut.join(' ')).toContain('Attach');
    expect(CALIBRATION_INSTRUCTIONS.cricut.join(' ')).toContain('SVG grouping alone does not replace Attach');
  });

  it('is deterministic across repeated coupon generation', () => {
    expect(createCalibrationCoupons()).toEqual(createCalibrationCoupons());
  });
});

interface ParsedCircle {
  x: number;
  y: number;
  r: number;
  fill: string | null;
}

interface ParsedSvg {
  svg: string;
  document: XmlDocument;
  widthMm: number;
  heightMm: number;
  viewBox: number[];
  circles: ParsedCircle[];
}

function parseSvg(svg: string): ParsedSvg {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (!root) throw new Error('SVG parser returned no root element.');
  const widthMm = parseMillimeters(root.getAttribute('width'));
  const heightMm = parseMillimeters(root.getAttribute('height'));
  const viewBox = (root.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const circles = Array.from(document.getElementsByTagName('circle')).map((circle) => ({
    x: Number(circle.getAttribute('cx')),
    y: Number(circle.getAttribute('cy')),
    r: Number(circle.getAttribute('r')),
    fill: circle.getAttribute('fill'),
  }));

  expect(root.tagName).toBe('svg');
  expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
  expect(viewBox).toHaveLength(4);
  expect(circles.every((circle) => Number.isFinite(circle.x) && Number.isFinite(circle.y) && Number.isFinite(circle.r))).toBe(true);

  return { svg, document, widthMm, heightMm, viewBox, circles };
}

function parseMillimeters(value: string | null): number {
  expect(value).toMatch(/^-?\d+(?:\.\d+)?mm$/);
  return Number(value?.slice(0, -2));
}

function measureCircleBounds(circles: readonly ParsedCircle[]) {
  return {
    minX: Math.min(...circles.map((circle) => circle.x - circle.r)),
    minY: Math.min(...circles.map((circle) => circle.y - circle.r)),
    maxX: Math.max(...circles.map((circle) => circle.x + circle.r)),
    maxY: Math.max(...circles.map((circle) => circle.y + circle.r)),
  };
}

function expectMinimumCenterDistance(circles: readonly ParsedCircle[], expectedDistanceMm: number): void {
  let observedMinimum = Number.POSITIVE_INFINITY;
  for (let first = 0; first < circles.length; first += 1) {
    for (let second = first + 1; second < circles.length; second += 1) {
      observedMinimum = Math.min(observedMinimum, Math.hypot(
        circles[first].x - circles[second].x,
        circles[first].y - circles[second].y,
      ));
    }
  }
  expect(observedMinimum).toBeCloseTo(expectedDistanceMm, 2);
  expect(observedMinimum).toBeGreaterThanOrEqual(expectedDistanceMm - TOLERANCE_MM);
}

function hasAttribute(element: XmlElement, name: string): boolean {
  if (element.hasAttribute(name)) return true;
  return Array.from(element.children).some((child) => hasAttribute(child, name));
}

function getElementNames(element: XmlElement): string[] {
  return [element.tagName, ...Array.from(element.children).flatMap((child) => getElementNames(child))];
}
