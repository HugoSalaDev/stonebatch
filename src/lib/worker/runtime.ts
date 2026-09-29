import { processStoneBatchProject, type WorkerProcessorDependencies } from './processor';
import type {
  SerializedWorkerError,
  StoneBatchWorkerRequest,
  StoneBatchWorkerResponse,
} from './protocol';

/** Handles one Worker request while preserving its local job ID on every response. */
export async function handleWorkerRequest(
  request: StoneBatchWorkerRequest,
  dependencies: WorkerProcessorDependencies,
  postMessage: (message: StoneBatchWorkerResponse) => void,
): Promise<void> {
  try {
    const result = await processStoneBatchProject(
      request.project,
      dependencies,
      (progress) => postMessage({ type: 'progress', id: request.id, progress }),
    );
    postMessage({ type: 'success', id: request.id, result });
  } catch (error) {
    postMessage({
      type: 'error',
      id: request.id,
      error: serializeWorkerError(error),
    });
  }
}

function serializeWorkerError(error: unknown): SerializedWorkerError {
  return {
    code: 'WORKER_PROCESSING_FAILED',
    message: 'Unable to calculate this design. Please try again.',
    technicalMessage: error instanceof Error ? error.message : String(error),
  };
}
