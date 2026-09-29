import { readFileSync } from 'node:fs';

import type { Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseMontserratBlack } from '../src/lib/engine/font-outlines';
import { CALIBRATION_INSTRUCTIONS, createCalibrationCoupons } from '../src/lib/export/svg-export';
import { processStoneBatchProject } from '../src/lib/worker/processor';
import {
  DEFAULT_EDITOR_DIAMETER_MM,
  DEFAULT_EDITOR_HEIGHT_MM,
  createEditorProject,
  createPreviewRows,
  getCommercialEligibility,
  getFirstFreeSvg,
  isGeneratedPreviewCurrent,
} from '../src/lib/ui/editor-state';

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

describe('T08 editor state', () => {
  it('uses 45 mm and 3.2 mm as defaults in the Worker project', () => {
    expect(createEditorProject({ input: 'ANNA', heightMm: DEFAULT_EDITOR_HEIGHT_MM, diameterMm: DEFAULT_EDITOR_DIAMETER_MM }))
      .toMatchObject({ input: 'ANNA', heightMm: 45, diameterMm: 3.2 });
  });

  it('keeps visible normalization, order and duplicates', async () => {
    const result = await calculate('anna\nANNA\nanna');
    const rows = createPreviewRows(result);

    expect(rows.map((row) => row.originalText)).toEqual(['anna', 'ANNA', 'anna']);
    expect(rows.map((row) => row.normalizedText)).toEqual(['ANNA', 'ANNA', 'ANNA']);
  });

  it('provides a valid card with physical metrics and hole count', async () => {
    const row = createPreviewRows(await calculate('ANNA'))[0];

    expect(row.valid).toBe(true);
    expect(row.design?.boundsMm?.width).toBeGreaterThan(0);
    expect(row.design?.boundsMm?.height).toBeGreaterThan(0);
    expect(row.design?.diameterMm).toBe(3.2);
    expect(row.design?.circleCount).toBeGreaterThan(0);
  });

  it('keeps input and geometric errors visible per row', async () => {
    const inputError = createPreviewRows(await calculate('José'))[0];
    const geometricError = createPreviewRows(await calculate('WWWW', 55))[0];

    expect(inputError.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_CHARACTER' })]));
    expect(geometricError.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WIDTH_LIMIT_EXCEEDED' })]));
  });

  it('invalidates an old generated result after editing and exports only the current first valid row', async () => {
    const project = createEditorProject({ input: 'ANNA\nMIA', heightMm: 45, diameterMm: 3.2 });
    const result = await calculate(project.input);
    const preview = { project, result };

    expect(isGeneratedPreviewCurrent(preview, { input: 'ANNA\nMIA', heightMm: 45, diameterMm: 3.2 })).toBe(true);
    expect(isGeneratedPreviewCurrent(preview, { input: 'ANNA\nLIA', heightMm: 45, diameterMm: 3.2 })).toBe(false);
    expect(getFirstFreeSvg(result)?.filename).toBe('01-ANNA-h45-d3p2.svg');
  });

  it('allows one free row but requires two valid rows for the commercial offer', async () => {
    expect(getCommercialEligibility(await calculate('ANNA')).eligible).toBe(false);
    expect(getCommercialEligibility(await calculate('ANNA\nMIA')).eligible).toBe(true);
    expect(getCommercialEligibility(await calculate('ANNA\nJosé')).eligible).toBe(false);
  });

  it('exposes all four reusable calibration coupons and instructions', () => {
    expect(createCalibrationCoupons()).toHaveLength(4);
    expect(CALIBRATION_INSTRUCTIONS.calibration.join(' ')).toContain('SS10');
    expect(CALIBRATION_INSTRUCTIONS.cricut.join(' ')).toContain('Attach');
  });
});

function calculate(input: string, heightMm = 45, diameterMm = 3.2) {
  return processStoneBatchProject(
    createEditorProject({ input, heightMm, diameterMm }),
    { loadFont: async () => font },
  );
}
