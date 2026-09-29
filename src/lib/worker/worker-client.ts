import type {
  SerializedWorkerError,
  StoneBatchWorkerProject,
  StoneBatchWorkerRequest,
  StoneBatchWorkerResponse,
  StoneBatchWorkerResult,
  WorkerProgress,
} from './protocol';

export type WorkerClientStatus = 'idle' | 'running' | 'success' | 'error';

export interface WorkerClientState {
  status: WorkerClientStatus;
  jobId: number | null;
  progress: WorkerProgress | null;
  result: StoneBatchWorkerResult | null;
  error: SerializedWorkerError | null;
}

export interface WorkerTransport {
  onmessage: ((event: { data: StoneBatchWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string; error?: unknown }) => void) | null;
  postMessage(message: StoneBatchWorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerTransport;
export type WorkerStateListener = (state: WorkerClientState) => void;

const INITIAL_STATE: WorkerClientState = {
  status: 'idle',
  jobId: null,
  progress: null,
  result: null,
  error: null,
};

/**
 * UI-independent job coordinator. Replacing a synchronous Worker job terminates
 * that Worker, which is the only reliable browser cancellation mechanism here.
 */
export class StoneBatchWorkerClient {
  private nextJobId = 0;
  private currentJobId: number | null = null;
  private worker: WorkerTransport | null = null;
  private lastProject: StoneBatchWorkerProject | null = null;
  private state: WorkerClientState = { ...INITIAL_STATE };
  private readonly listeners = new Set<WorkerStateListener>();

  public constructor(private readonly workerFactory: WorkerFactory = createBrowserWorker) {}

  public run(project: StoneBatchWorkerProject): number {
    const jobId = ++this.nextJobId;
    const stableProject = { ...project };
    this.lastProject = stableProject;

    if (this.state.status === 'running' || this.state.status === 'error') {
      this.disposeWorker();
    }

    this.currentJobId = jobId;
    this.setState({
      status: 'running',
      jobId,
      progress: null,
      result: null,
      error: null,
    });

    try {
      const worker = this.worker ?? this.createWorker();
      this.worker = worker;
      worker.postMessage({ type: 'run', id: jobId, project: stableProject });
    } catch (error) {
      this.failCurrentJob(jobId, error);
    }

    return jobId;
  }

  public retry(): number {
    if (!this.lastProject) {
      throw new Error('No StoneBatch Worker project is available to retry.');
    }

    return this.run(this.lastProject);
  }

  public cancel(): void {
    this.disposeWorker();
    this.currentJobId = null;
    this.setState({ ...INITIAL_STATE });
  }

  public getState(): WorkerClientState {
    return this.state;
  }

  public subscribe(listener: WorkerStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public getActiveWorkerCount(): number {
    return this.state.status === 'running' && this.worker ? 1 : 0;
  }

  private createWorker(): WorkerTransport {
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      if (this.currentJobId !== null) {
        this.failCurrentJob(this.currentJobId, event.error ?? new Error(event.message ?? 'Worker failure.'));
      }
    };
    return worker;
  }

  private handleMessage(message: StoneBatchWorkerResponse): void {
    if (message.id !== this.currentJobId || this.state.status !== 'running') {
      return;
    }

    if (message.type === 'progress') {
      this.setState({ ...this.state, progress: message.progress });
      return;
    }

    if (message.type === 'success') {
      this.currentJobId = null;
      this.setState({
        status: 'success',
        jobId: message.id,
        progress: { completedRows: message.result.validation.rows.length, totalRows: message.result.validation.rows.length, fraction: 1 },
        result: message.result,
        error: null,
      });
      return;
    }

    this.currentJobId = null;
    this.setState({
      status: 'error',
      jobId: message.id,
      progress: null,
      result: null,
      error: message.error,
    });
  }

  private failCurrentJob(jobId: number, error: unknown): void {
    if (jobId !== this.currentJobId) return;
    this.currentJobId = null;
    this.setState({
      status: 'error',
      jobId,
      progress: null,
      result: null,
      error: serializeClientError(error),
    });
  }

  private disposeWorker(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
  }

  private setState(state: WorkerClientState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export function createBrowserWorker(): WorkerTransport {
  return new Worker(new URL('../../workers/stonebatch.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerTransport;
}

function serializeClientError(error: unknown): SerializedWorkerError {
  return {
    code: 'WORKER_PROCESSING_FAILED',
    message: 'Unable to calculate this design. Please try again.',
    technicalMessage: error instanceof Error ? error.message : String(error),
  };
}
