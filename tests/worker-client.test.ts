import { describe, expect, it } from 'vitest';

import { validateInput } from '../src/lib/input/normalize';
import {
  StoneBatchWorkerClient,
  type WorkerTransport,
} from '../src/lib/worker/worker-client';
import {
  WORKER_PROJECT_SCHEMA_VERSION,
  type StoneBatchWorkerProject,
  type StoneBatchWorkerResponse,
} from '../src/lib/worker/protocol';

describe('StoneBatch Worker client', () => {
  it('assigns monotonic local IDs and sends each project only to the Worker transport', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));

    const first = client.run(project('ANNA'));
    const second = client.run(project('MIA'));

    expect([first, second]).toEqual([1, 2]);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].posted).toEqual([{ type: 'run', id: 2, project: project('MIA') }]);
    expect(client.getState()).toMatchObject({ status: 'running', jobId: 2 });
  });

  it('accepts a response only when its ID matches the active request', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    const id = client.run(project('ANNA'));

    workers[0].emit(success(id, 'ANNA'));

    expect(client.getState()).toMatchObject({ status: 'success', jobId: id });
    expect(client.getState().result?.validation.rows[0].normalizedText).toBe('ANNA');
  });

  it('reuses an idle Worker so its locally loaded font can remain cached', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    const firstId = client.run(project('ANNA'));
    workers[0].emit(success(firstId, 'ANNA'));

    const secondId = client.run(project('MIA'));

    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toEqual([
      { type: 'run', id: firstId, project: project('ANNA') },
      { type: 'run', id: secondId, project: project('MIA') },
    ]);
  });

  it('ignores an old result after a newer job replaces it', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    const oldId = client.run(project('ANNA'));
    const newId = client.run(project('MIA'));

    workers[0].emit(success(oldId, 'ANNA'));
    expect(client.getState()).toMatchObject({ status: 'running', jobId: newId, result: null });

    workers[1].emit(success(newId, 'MIA'));
    expect(client.getState().result?.validation.rows[0].normalizedText).toBe('MIA');
  });

  it('ignores old progress after replacement and exposes current row progress', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    const oldId = client.run(project('ANNA'));
    const newId = client.run(project('MIA'));

    workers[0].emit({ type: 'progress', id: oldId, progress: { completedRows: 1, totalRows: 1, fraction: 1 } });
    expect(client.getState().progress).toBeNull();

    workers[1].emit({ type: 'progress', id: newId, progress: { completedRows: 1, totalRows: 2, fraction: 0.5 } });
    expect(client.getState().progress).toEqual({ completedRows: 1, totalRows: 2, fraction: 0.5 });
  });

  it('ignores a late error from the replaced Worker and completes the current job', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    const firstId = client.run(project('ANNA'));
    const secondId = client.run(project('MIA'));

    workers[0].emitError('late failure from the replaced Worker');
    expect(client.getState()).toMatchObject({ status: 'running', jobId: secondId, error: null });

    workers[1].emit(success(secondId, 'MIA'));
    expect(firstId).toBeLessThan(secondId);
    expect(client.getState()).toMatchObject({ status: 'success', jobId: secondId, error: null });
    expect(client.getState().result?.validation.rows[0].normalizedText).toBe('MIA');
  });

  it('recovers from a Worker failure and retries the same project on a recreated Worker', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    const firstId = client.run(project('ANNA'));

    workers[0].emit({
      type: 'error',
      id: firstId,
      error: { code: 'WORKER_PROCESSING_FAILED', message: 'Unable to calculate this design.', technicalMessage: 'font unavailable' },
    });
    expect(client.getState()).toMatchObject({ status: 'error', jobId: firstId });

    const retryId = client.retry();
    expect(retryId).toBe(2);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(client.getState()).toMatchObject({ status: 'running', jobId: retryId });
  });

  it('replaces repeated running jobs without accumulating active Workers or blocking the caller', () => {
    const workers: FakeWorker[] = [];
    const client = new StoneBatchWorkerClient(() => createFakeWorker(workers));
    let callerContinued = false;

    for (let index = 0; index < 20; index += 1) {
      client.run(project(`ANNA-${index}`));
    }
    callerContinued = true;

    expect(callerContinued).toBe(true);
    expect(workers).toHaveLength(20);
    expect(workers.slice(0, -1).every((worker) => worker.terminated)).toBe(true);
    expect(workers.at(-1)?.terminated).toBe(false);
    expect(client.getActiveWorkerCount()).toBe(1);
  });
});

class FakeWorker implements WorkerTransport {
  public onmessage: ((event: { data: StoneBatchWorkerResponse }) => void) | null = null;
  public onerror: ((event: { message?: string; error?: unknown }) => void) | null = null;
  public readonly posted: unknown[] = [];
  public terminated = false;

  public postMessage(message: unknown): void {
    this.posted.push(message);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public emit(message: StoneBatchWorkerResponse): void {
    this.onmessage?.({ data: message });
  }

  public emitError(message: string): void {
    this.onerror?.({ message, error: new Error(message) });
  }
}

function createFakeWorker(workers: FakeWorker[]): FakeWorker {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}

function project(input: string): StoneBatchWorkerProject {
  return { schemaVersion: WORKER_PROJECT_SCHEMA_VERSION, input, heightMm: 45, diameterMm: 3.2 };
}

function success(id: number, input: string): StoneBatchWorkerResponse {
  return {
    type: 'success',
    id,
    result: {
      validation: validateInput(input),
      batch: null,
    },
  };
}
