import { readFileSync } from 'node:fs';

import { strFromU8, unzipSync } from 'fflate';
import type { Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createDevTestBatchZipAccess, NO_BATCH_ZIP_ACCESS } from '../src/lib/export/batch-zip-access';
import {
  BATCH_MANIFEST_FILENAME,
  BATCH_MANIFEST_HEADERS,
  BATCH_README_FILENAME,
  createBatchZip,
  createBatchZipFilename,
  serializeCsv,
} from '../src/lib/export/batch-zip';
import { exportRowSvg } from '../src/lib/export/svg-export';
import { parseMontserratBlack } from '../src/lib/engine/font-outlines';
import { createEditorProject } from '../src/lib/ui/editor-state';
import { processStoneBatchProject } from '../src/lib/worker/processor';

const FONT_BYTES = readFileSync(new URL('../public/fonts/montserrat-black-900-v25.woff', import.meta.url));
const FONT_BUFFER = FONT_BYTES.buffer.slice(FONT_BYTES.byteOffset, FONT_BYTES.byteOffset + FONT_BYTES.byteLength) as ArrayBuffer;
const TEST_ACCESS = createDevTestBatchZipAccess();
let font: Font;

beforeAll(() => { font = parseMontserratBlack(FONT_BUFFER); });

describe('T09 batch ZIP', () => {
  it('creates two ordered SVGs plus exactly one manifest and README', async () => {
    const result = await calculate('ANNA\nMIA');
    const archive = createBatchZip(result, TEST_ACCESS, { batchDate: '2026-09-29' });
    const files = unzip(archive.bytes);

    expect(archive.filename).toBe('stonebatch-20260929.zip');
    expect(Object.keys(files)).toEqual(['01-ANNA-h45-d3p2.svg', '02-MIA-h45-d3p2.svg', BATCH_MANIFEST_FILENAME, BATCH_README_FILENAME]);
    expect(files['01-ANNA-h45-d3p2.svg']).toBe(exportRowSvg(result.batch!.rows[0], 1).svg);
    expect(files['02-MIA-h45-d3p2.svg']).toBe(exportRowSvg(result.batch!.rows[1], 2).svg);
    expect(archive.files).toHaveLength(4);
  });

  it('keeps duplicate texts as different numbered SVG files', async () => {
    const archive = createBatchZip(await calculate('ANNA\nANNA\nANNA'), TEST_ACCESS, { batchDate: '2026-01-02' });
    expect(Object.keys(unzip(archive.bytes)).filter((name) => name.endsWith('.svg')))
      .toEqual(['01-ANNA-h45-d3p2.svg', '02-ANNA-h45-d3p2.svg', '03-ANNA-h45-d3p2.svg']);
  });

  it('creates exactly 32 files for 30 valid rows', async () => {
    const archive = createBatchZip(await calculate(Array.from({ length: 30 }, () => 'ANNA').join('\n')), TEST_ACCESS, { batchDate: '2026-09-29' });
    expect(Object.keys(unzip(archive.bytes))).toHaveLength(32);
  });

  it('writes a manifest matching the calculated rows and actual SVG metrics', async () => {
    const result = await calculate('ANNA\nA-2', 35, 3.6);
    const archive = createBatchZip(result, TEST_ACCESS, { batchDate: '2026-03-04' });
    const rows = parseCsv(unzip(archive.bytes)[BATCH_MANIFEST_FILENAME]);
    const exported = result.batch!.rows.map((row, index) => exportRowSvg(row, index + 1));
    expect(rows[0]).toEqual([...BATCH_MANIFEST_HEADERS]);
    expect(rows).toHaveLength(3);
    expect(rows.slice(1)).toEqual(exported.map((svg, index) => [
      String(index + 1), svg.text, svg.filename, String(svg.nominalHeightMm), String(svg.widthMm), String(svg.heightMm),
      String(svg.diameterMm), String(svg.circleCount), svg.engineVersion,
    ]));
  });

  it('uses UTF-8 CSV escaping and centrally protects spreadsheet formulas', () => {
    expect(serializeCsv([['text', 'value'], ['café, "name"', '=SUM(A1:A2)'], ['line\nbreak', '+1'], ['-2', '@test']]))
      .toBe('text,value\r\n"café, ""name""",\'=SUM(A1:A2)\r\n"line\nbreak",\'+1\r\n\'-2,\'@test');
  });

  it('includes the batch parameters and Cricut safeguards in README.txt', async () => {
    const archive = createBatchZip(await calculate('ANNA\nMIA', 55, 3), TEST_ACCESS, { batchDate: '2026-07-08' });
    const readme = unzip(archive.bytes)[BATCH_README_FILENAME];
    expect(readme).toContain('StoneBatch');
    expect(readme).toContain('Batch date: 2026-07-08');
    expect(readme).toContain('Nominal letter height: 55 mm');
    expect(readme).toContain('Hole diameter: 3.0 mm');
    expect(readme).toContain('manifest.csv');
    expect(readme).toContain('Attach');
    expect(readme).toContain('Do not scale');
  });

  it('rejects invalid batches and unavailable production access', async () => {
    const invalid = await calculate('WWWW\nANNA', 55);
    const valid = await calculate('ANNA\nMIA');
    const withoutBatch = { ...valid, batch: null };
    const inconsistent = { ...valid, batch: { ...valid.batch!, rows: valid.batch!.rows.slice(0, 1) } };
    expect(() => createBatchZip(invalid, TEST_ACCESS, { batchDate: '2026-09-29' })).toThrow('valid batch');
    expect(() => createBatchZip(withoutBatch, TEST_ACCESS, { batchDate: '2026-09-29' })).toThrow('calculated batch');
    expect(() => createBatchZip(inconsistent, TEST_ACCESS, { batchDate: '2026-09-29' })).toThrow('row count');
    expect(() => createBatchZip(valid, NO_BATCH_ZIP_ACCESS, { batchDate: '2026-09-29' })).toThrow('authorized access');
    expect(TEST_ACCESS.authorized).toBe(true);
    expect(NO_BATCH_ZIP_ACCESS.authorized).toBe(false);
    expect(createBatchZipFilename('2026-09-29')).toBe('stonebatch-20260929.zip');
  });

  it('does not contain extra ZIP files or network calls in the generator/access adapter', async () => {
    const archive = createBatchZip(await calculate('ANNA\nMIA'), TEST_ACCESS, { batchDate: '2026-09-29' });
    expect(Object.keys(unzip(archive.bytes)).every((name) => name.endsWith('.svg') || name === BATCH_MANIFEST_FILENAME || name === BATCH_README_FILENAME)).toBe(true);
    const source = readFileSync(new URL('../src/lib/export/batch-zip.ts', import.meta.url), 'utf8');
    const accessSource = readFileSync(new URL('../src/lib/export/batch-zip-access.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('XMLHttpRequest');
    expect(accessSource).not.toContain('URLSearchParams');
    expect(accessSource).not.toContain('localStorage');
    expect(accessSource).not.toContain('environment:');
  });

  it('keeps logical ZIP content deterministic for the same batch and supplied date', async () => {
    const result = await calculate('ANNA\nMIA');
    const first = createBatchZip(result, TEST_ACCESS, { batchDate: '2026-09-29' });
    const second = createBatchZip(result, TEST_ACCESS, { batchDate: '2026-09-29' });
    expect(unzip(first.bytes)).toEqual(unzip(second.bytes));
  });
});

async function calculate(input: string, heightMm = 45, diameterMm = 3.2) {
  return processStoneBatchProject(createEditorProject({ input, heightMm, diameterMm }), { loadFont: async () => font });
}

function unzip(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, content]) => [name, strFromU8(content)]));
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [[]];
  let field = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted && character === '"' && csv[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ',') { rows.at(-1)!.push(field); field = ''; continue; }
    if (!quoted && character === '\r' && csv[index + 1] === '\n') { rows.at(-1)!.push(field); rows.push([]); field = ''; index += 1; continue; }
    field += character;
  }
  rows.at(-1)!.push(field);
  return rows;
}
