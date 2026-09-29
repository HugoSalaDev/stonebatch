import type { RhinestoneRowResult } from '../engine/rhinestone-grid';
import { exportRowSvg, type SvgDesignExport } from '../export/svg-export';
import {
  WORKER_PROJECT_SCHEMA_VERSION,
  type StoneBatchWorkerProject,
  type StoneBatchWorkerResult,
} from '../worker/protocol';

export const DEFAULT_EDITOR_HEIGHT_MM = 45;
export const DEFAULT_EDITOR_DIAMETER_MM = 3.2;

export interface EditorInputs {
  input: string;
  heightMm: number;
  diameterMm: number;
}

export interface GeneratedPreview {
  project: StoneBatchWorkerProject;
  result: StoneBatchWorkerResult;
}

export interface PreviewError {
  code: string;
  message: string;
}

export interface PreviewRow {
  index: number;
  originalText: string;
  normalizedText: string;
  valid: boolean;
  errors: PreviewError[];
  design: RhinestoneRowResult | null;
}

export interface CommercialEligibility {
  eligible: boolean;
  reason: string | null;
}

export function createEditorProject(inputs: EditorInputs): StoneBatchWorkerProject {
  return {
    schemaVersion: WORKER_PROJECT_SCHEMA_VERSION,
    input: inputs.input,
    heightMm: inputs.heightMm,
    diameterMm: inputs.diameterMm,
  };
}

export function isGeneratedPreviewCurrent(preview: GeneratedPreview, inputs: EditorInputs): boolean {
  const project = createEditorProject(inputs);
  return preview.project.input === project.input
    && preview.project.heightMm === project.heightMm
    && preview.project.diameterMm === project.diameterMm
    && preview.project.schemaVersion === project.schemaVersion;
}

export function createPreviewRows(result: StoneBatchWorkerResult): PreviewRow[] {
  return result.validation.rows.map((inputRow, index) => {
    const design = result.batch?.rows[index] ?? null;
    const errors: PreviewError[] = [
      ...inputRow.errors.map(({ code, message }) => ({ code, message })),
      ...(design?.errors ?? []).map(({ code, message }) => ({ code, message })),
    ];

    return {
      index: index + 1,
      originalText: inputRow.originalText,
      normalizedText: inputRow.normalizedText,
      valid: inputRow.errors.length === 0 && design?.valid === true,
      errors,
      design,
    };
  });
}

export function getCommercialEligibility(result: StoneBatchWorkerResult): CommercialEligibility {
  if (!result.validation.valid) {
    return { eligible: false, reason: 'Correct every input error before exporting the batch.' };
  }
  if (!result.batch || !result.batch.valid) {
    return { eligible: false, reason: 'Correct every design error before exporting the batch.' };
  }
  if (result.batch.rows.length < 2) {
    return { eligible: false, reason: 'Add at least two valid texts to export the batch.' };
  }
  if (result.batch.errors.length > 0 || result.batch.rows.some((row) => !row.valid)) {
    return { eligible: false, reason: 'Correct every design error before exporting the batch.' };
  }

  return { eligible: true, reason: null };
}

/** A commercial CTA is only interactive for a current, fully valid batch. */
export function isCommercialExportEnabled(
  result: StoneBatchWorkerResult | null,
  previewIsCurrent: boolean,
): boolean {
  return previewIsCurrent && result !== null && getCommercialEligibility(result).eligible;
}

export function getFirstFreeSvg(result: StoneBatchWorkerResult): SvgDesignExport | null {
  const firstRow = result.batch?.rows[0];
  return firstRow?.valid ? exportRowSvg(firstRow, 1) : null;
}
