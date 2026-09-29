import type { PointMm } from '../engine/font-outlines';
import {
  ALLOWED_DIAMETERS_MM,
  MIN_EDGE_GAP_MM,
  RHINESTONE_ENGINE_VERSION,
  type DiameterMm,
  type RhinestoneRowResult,
} from '../engine/rhinestone-grid';

export const SVG_EXPORT_VERSION = 'stonebatch-svg-v1';
export const CALIBRATION_GRID_COLUMNS = 5;
export const CALIBRATION_GRID_ROWS = 5;

export interface SvgDesignExport {
  filename: string;
  svg: string;
  widthMm: number;
  heightMm: number;
  diameterMm: DiameterMm;
  circleCount: number;
  text: string;
  nominalHeightMm: RhinestoneRowResult['nominalHeightMm'];
  engineVersion: typeof RHINESTONE_ENGINE_VERSION;
  exportVersion: typeof SVG_EXPORT_VERSION;
  /** The uniform translation applied to every T04 circle before serialization. */
  translationMm: PointMm;
}

export interface CalibrationCoupon {
  filename: string;
  svg: string;
  widthMm: number;
  heightMm: number;
  diameterMm: DiameterMm;
  circleCount: number;
  horizontalSpacingMm: number;
  verticalSpacingMm: number;
  exportVersion: typeof SVG_EXPORT_VERSION;
}

export interface CalibrationInstructions {
  calibration: readonly string[];
  cricut: readonly string[];
}

/** Reusable copy for a future calibration/download interface. */
export const CALIBRATION_INSTRUCTIONS: CalibrationInstructions = Object.freeze({
  calibration: Object.freeze([
    'Test all four samples with your own material.',
    'Determine which hole diameter fits your rhinestones best before creating a design.',
    'SS10 does not mean every rhinestone has exactly the selected diameter.',
    'Do not assume there is one universal pressure, blade, or material setting; adjust them to your machine and material.',
  ]),
  cricut: Object.freeze([
    'Import the SVG as a cut.',
    'Verify the width and height against the design measurements.',
    'Select all design elements and use Attach to preserve their placement on the mat.',
    'SVG grouping alone does not replace Attach.',
  ]),
});

/**
 * Exports one valid T04 row. Coordinates are only translated by the negated
 * real-circle minimum so that the SVG viewBox begins at 0,0; no scale is applied.
 */
export function exportRowSvg(row: RhinestoneRowResult, index: number): SvgDesignExport {
  if (!row.valid || !row.boundsMm || row.circleCount === 0) {
    throw new Error('Only a valid T04 row with circles can be exported as SVG.');
  }
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('SVG export index must be a positive integer.');
  }

  const translationMm = {
    x: -row.boundsMm.minX,
    y: -row.boundsMm.minY,
  };
  const widthMm = row.boundsMm.width;
  const heightMm = row.boundsMm.height;

  return {
    filename: createSvgFilename(index, row.text, row.nominalHeightMm, row.diameterMm),
    svg: serializeSvg(widthMm, heightMm, row.circles.map((circle) => ({
      x: circle.x + translationMm.x,
      y: circle.y + translationMm.y,
      diameterMm: circle.diameterMm,
    }))),
    widthMm,
    heightMm,
    diameterMm: row.diameterMm,
    circleCount: row.circleCount,
    text: row.text,
    nominalHeightMm: row.nominalHeightMm,
    engineVersion: row.engineVersion,
    exportVersion: SVG_EXPORT_VERSION,
    translationMm,
  };
}

/** Preserves the incoming batch order, including duplicate normalized rows. */
export function exportRowsSvg(rows: readonly RhinestoneRowResult[]): SvgDesignExport[] {
  return rows.map((row, index) => exportRowSvg(row, index + 1));
}

export function createSvgFilename(
  index: number,
  text: string,
  nominalHeightMm: RhinestoneRowResult['nominalHeightMm'],
  diameterMm: DiameterMm,
): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('SVG export index must be a positive integer.');
  }
  if (!/^[A-Z0-9 -]+$/.test(text)) {
    throw new Error('SVG filename text must already use the StoneBatch normalized alphabet.');
  }

  return `${String(index).padStart(2, '0')}-${text}-h${nominalHeightMm}-d${formatDiameter(diameterMm)}.svg`;
}

/** Generates the four T05 5×5 physical calibration SVGs. */
export function createCalibrationCoupons(): CalibrationCoupon[] {
  return ALLOWED_DIAMETERS_MM.map((diameterMm) => {
    const horizontalSpacingMm = diameterMm + MIN_EDGE_GAP_MM;
    const verticalSpacingMm = horizontalSpacingMm * Math.sqrt(3) / 2;
    const radiusMm = diameterMm / 2;
    const circles = Array.from({ length: CALIBRATION_GRID_ROWS }, (_, row) => {
      const rowOffsetMm = row % 2 === 0 ? 0 : horizontalSpacingMm / 2;
      return Array.from({ length: CALIBRATION_GRID_COLUMNS }, (_, column) => ({
        x: radiusMm + rowOffsetMm + column * horizontalSpacingMm,
        y: radiusMm + row * verticalSpacingMm,
        diameterMm,
      }));
    }).flat();
    const widthMm = diameterMm + (CALIBRATION_GRID_COLUMNS - 1) * horizontalSpacingMm + horizontalSpacingMm / 2;
    const heightMm = diameterMm + (CALIBRATION_GRID_ROWS - 1) * verticalSpacingMm;

    return {
      filename: `stonebatch-calibration-d${formatDiameter(diameterMm)}.svg`,
      svg: serializeSvg(widthMm, heightMm, circles),
      widthMm,
      heightMm,
      diameterMm,
      circleCount: circles.length,
      horizontalSpacingMm,
      verticalSpacingMm,
      exportVersion: SVG_EXPORT_VERSION,
    };
  });
}

interface SerializableCircle extends PointMm {
  diameterMm: DiameterMm;
}

function serializeSvg(widthMm: number, heightMm: number, circles: readonly SerializableCircle[]): string {
  const width = formatMillimeters(widthMm);
  const height = formatMillimeters(heightMm);
  const circleMarkup = circles
    .map((circle) => `    <circle cx="${formatMillimeters(circle.x)}" cy="${formatMillimeters(circle.y)}" r="${formatMillimeters(circle.diameterMm / 2)}" fill="black"/>`)
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    '  <g>',
    circleMarkup,
    '  </g>',
    '</svg>',
  ].join('\n');
}

function formatDiameter(diameterMm: DiameterMm): string {
  return diameterMm.toFixed(1).replace('.', 'p');
}

function formatMillimeters(value: number): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return normalized.toFixed(3);
}
