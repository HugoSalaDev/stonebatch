import type { InputValidationResult } from '../input/normalize';
import type { RhinestoneBatchResult } from '../engine/rhinestone-grid';

export const WORKER_PROJECT_SCHEMA_VERSION = 'stonebatch-worker-project-v1';

/** Only serializable input required to reproduce a StoneBatch calculation locally. */
export interface StoneBatchWorkerProject {
  schemaVersion: typeof WORKER_PROJECT_SCHEMA_VERSION;
  input: string;
  heightMm: number;
  diameterMm: number;
}

export interface WorkerProgress {
  completedRows: number;
  totalRows: number;
  fraction: number;
}

export interface StoneBatchWorkerResult {
  validation: InputValidationResult;
  batch: RhinestoneBatchResult | null;
}

export interface SerializedWorkerError {
  code: 'WORKER_PROCESSING_FAILED';
  message: string;
  technicalMessage?: string;
}

export interface WorkerRunRequest {
  type: 'run';
  id: number;
  project: StoneBatchWorkerProject;
}

export interface WorkerProgressResponse {
  type: 'progress';
  id: number;
  progress: WorkerProgress;
}

export interface WorkerSuccessResponse {
  type: 'success';
  id: number;
  result: StoneBatchWorkerResult;
}

export interface WorkerErrorResponse {
  type: 'error';
  id: number;
  error: SerializedWorkerError;
}

export type StoneBatchWorkerRequest = WorkerRunRequest;
export type StoneBatchWorkerResponse =
  | WorkerProgressResponse
  | WorkerSuccessResponse
  | WorkerErrorResponse;
