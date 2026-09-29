import type { Font } from 'opentype.js';

import { createTextGeometry } from '../engine/font-outlines';
import {
  createRhinestoneBatchResult,
  generateRhinestoneRow,
  type DiameterMm,
} from '../engine/rhinestone-grid';
import { validateInput } from '../input/normalize';
import {
  WORKER_PROJECT_SCHEMA_VERSION,
  type StoneBatchWorkerProject,
  type StoneBatchWorkerResult,
  type WorkerProgress,
} from './protocol';

export interface WorkerProcessorDependencies {
  loadFont: () => Promise<Font>;
}

/**
 * Runs exactly the T02–T04 pipeline using no canvas, DOM, screen or network API.
 * The Worker runtime supplies a cached local-font loader.
 */
export async function processStoneBatchProject(
  project: StoneBatchWorkerProject,
  dependencies: WorkerProcessorDependencies,
  onProgress?: (progress: WorkerProgress) => void,
): Promise<StoneBatchWorkerResult> {
  if (project.schemaVersion !== WORKER_PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported StoneBatch Worker project schema: ${String(project.schemaVersion)}.`);
  }

  const validation = validateInput(project.input, {
    heightMm: project.heightMm,
    holeDiameterMm: project.diameterMm,
  });

  if (!validation.valid) {
    return { validation, batch: null };
  }

  const heightMm = validation.parameters.selected.heightMm;
  const diameterMm = validation.parameters.selected.holeDiameterMm;
  if (heightMm === null || diameterMm === null) {
    throw new Error('Validated StoneBatch parameters were unexpectedly unavailable.');
  }

  const totalRows = validation.rows.length;
  onProgress?.({ completedRows: 0, totalRows, fraction: 0 });
  const font = await dependencies.loadFont();
  const rows = validation.rows.map((row, index) => {
    const geometry = createTextGeometry(font, row.normalizedText, heightMm);
    const result = generateRhinestoneRow(geometry, diameterMm as DiameterMm, index + 1);
    const completedRows = index + 1;
    onProgress?.({
      completedRows,
      totalRows,
      fraction: completedRows / totalRows,
    });
    return result;
  });

  return {
    validation,
    batch: createRhinestoneBatchResult(rows, diameterMm as DiameterMm),
  };
}
