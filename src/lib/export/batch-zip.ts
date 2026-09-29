import { strToU8, zipSync } from 'fflate';

import { exportRowSvg, type SvgDesignExport } from './svg-export';
import type { BatchZipAccess } from './batch-zip-access';
import type { StoneBatchWorkerResult } from '../worker/protocol';

export const BATCH_MANIFEST_FILENAME = 'manifest.csv';
export const BATCH_README_FILENAME = 'README.txt';
export const BATCH_MANIFEST_HEADERS = [
  'index',
  'normalized_text',
  'svg_filename',
  'nominal_height_mm',
  'actual_width_mm',
  'actual_height_mm',
  'hole_diameter_mm',
  'hole_count',
  'engine_version',
] as const;

export interface BatchZipOptions {
  /** Caller-supplied calendar date, deliberately isolated from timezone policy. */
  batchDate: string;
}

export interface BatchZipFile {
  name: string;
  content: string;
}

export interface BatchZipArchive {
  filename: string;
  bytes: Uint8Array;
  files: readonly BatchZipFile[];
  manifestCsv: string;
  readme: string;
}

/**
 * Builds the T09 commercial archive from already calculated T07/T08 output.
 * It never invokes the Worker or geometry engine and has no network behavior.
 */
export function createBatchZip(
  result: StoneBatchWorkerResult,
  access: BatchZipAccess,
  options: BatchZipOptions,
): BatchZipArchive {
  assertBatchZipAccess(access);
  const batch = assertExportableBatch(result);
  const batchDate = assertBatchDate(options.batchDate);
  const svgFiles = batch.rows.map((row, index) => {
    const svg = exportRowSvg(row, index + 1);
    return { name: svg.filename, content: svg.svg, svg };
  });

  if (svgFiles.length !== batch.rows.length || new Set(svgFiles.map((file) => file.name)).size !== svgFiles.length) {
    throw new Error('Batch SVG file list is inconsistent with the calculated rows.');
  }

  const manifestCsv = createManifestCsv(svgFiles.map(({ svg }) => svg));
  const readme = createBatchReadme(batchDate, svgFiles);
  const files: BatchZipFile[] = [
    ...svgFiles.map(({ name, content }) => ({ name, content })),
    { name: BATCH_MANIFEST_FILENAME, content: manifestCsv },
    { name: BATCH_README_FILENAME, content: readme },
  ];
  const bytes = zipSync(Object.fromEntries(files.map((file) => [file.name, strToU8(file.content)])));

  return {
    filename: createBatchZipFilename(batchDate),
    bytes,
    files,
    manifestCsv,
    readme,
  };
}

export function createBatchZipFilename(batchDate: string): string {
  return `stonebatch-${assertBatchDate(batchDate).replaceAll('-', '')}.zip`;
}

export function createManifestCsv(exports: readonly SvgDesignExport[]): string {
  const records = exports.map((svg, index) => [
    index + 1,
    svg.text,
    svg.filename,
    svg.nominalHeightMm,
    svg.widthMm,
    svg.heightMm,
    svg.diameterMm,
    svg.circleCount,
    svg.engineVersion,
  ]);
  return serializeCsv([BATCH_MANIFEST_HEADERS, ...records]);
}

/** Correct UTF-8 CSV serialization, including spreadsheet formula protection. */
export function serializeCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(serializeCsvValue).join(',')).join('\r\n');
}

export function serializeCsvValue(value: unknown): string {
  const raw = String(value ?? '');
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

function createBatchReadme(batchDate: string, svgFiles: readonly { svg: SvgDesignExport }[]): string {
  const first = svgFiles[0]?.svg;
  if (!first) throw new Error('A StoneBatch README requires at least one SVG design.');

  return [
    'StoneBatch batch export',
    `Batch date: ${batchDate}`,
    `Nominal letter height: ${first.nominalHeightMm} mm`,
    `Hole diameter: ${first.diameterMm.toFixed(1)} mm`,
    `Number of designs: ${svgFiles.length}`,
    '',
    'The actual width and height for every design are listed in manifest.csv.',
    'Import each SVG as a cut in Cricut Design Space.',
    'Check the imported width and height against manifest.csv.',
    'Select all design elements and use Attach to preserve their positions on the mat.',
    'SVG grouping alone does not replace Attach.',
    'Do not scale a design in Cricut without checking the hole diameter again.',
  ].join('\n');
}

function assertBatchZipAccess(access: BatchZipAccess): void {
  if (!access.authorized) {
    throw new Error('Batch ZIP export requires authorized access.');
  }
}

function assertExportableBatch(result: StoneBatchWorkerResult) {
  if (!result.batch) throw new Error('Batch ZIP export requires a calculated batch.');
  if (!result.validation.valid) throw new Error('Batch ZIP export requires valid input.');
  if (!result.batch.valid) throw new Error('Batch ZIP export requires a valid batch.');
  if (result.batch.rows.length === 0) throw new Error('Batch ZIP export requires at least one design.');
  if (result.batch.rows.length !== result.validation.rows.length) {
    throw new Error('Batch ZIP export row count does not match the validated input.');
  }
  if (result.batch.errors.length > 0 || result.batch.rows.some((row) => !row.valid)) {
    throw new Error('Batch ZIP export cannot include invalid rows.');
  }
  if (result.batch.rows.some((row, index) => row.text !== result.validation.rows[index].normalizedText)) {
    throw new Error('Batch ZIP export rows do not match the normalized input order.');
  }
  return result.batch;
}

function assertBatchDate(batchDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batchDate)) {
    throw new Error('Batch ZIP date must be a caller-supplied YYYY-MM-DD calendar date.');
  }
  return batchDate;
}
