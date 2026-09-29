import { readFileSync } from 'node:fs';

import type { Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { FONT_ASSET_URL, createTextGeometry, parseMontserratBlack } from '../src/lib/engine/font-outlines';
import { generateRhinestoneBatch } from '../src/lib/engine/rhinestone-grid';
import { validateInput } from '../src/lib/input/normalize';
import { processStoneBatchProject } from '../src/lib/worker/processor';
import { handleWorkerRequest } from '../src/lib/worker/runtime';
import {
  WORKER_PROJECT_SCHEMA_VERSION,
  type StoneBatchWorkerProject,
  type StoneBatchWorkerResponse,
  type WorkerProgress,
} from '../src/lib/worker/protocol';

const FONT_PATH = new URL('../public/fonts/montserrat-black-900-v25.woff', import.meta.url);
const WORKER_SOURCE_PATH = new URL('../src/workers/stonebatch.worker.ts', import.meta.url);
const FONT_BYTES = readFileSync(FONT_PATH);
const FONT_BUFFER = FONT_BYTES.buffer.slice(
  FONT_BYTES.byteOffset,
  FONT_BYTES.byteOffset + FONT_BYTES.byteLength,
) as ArrayBuffer;

let font: Font;

beforeAll(() => {
  font = parseMontserratBlack(FONT_BUFFER);
});

describe('StoneBatch Worker processor', () => {
  it('processes a single valid row locally', async () => {
    const result = await runProject('ANNA', 45, 3.2);

    expect(result.validation.rows).toHaveLength(1);
    expect(result.batch?.rows).toHaveLength(1);
    expect(result.batch?.rows[0].text).toBe('ANNA');
  });

  it('keeps normalized order and duplicate rows', async () => {
    const result = await runProject('anna\nANNA\nanna', 45, 3.2);

    expect(result.validation.rows.map((row) => row.normalizedText)).toEqual(['ANNA', 'ANNA', 'ANNA']);
    expect(result.batch?.rows.map((row) => row.text)).toEqual(['ANNA', 'ANNA', 'ANNA']);
  });

  it('matches the direct T02–T04 result, including dimensions, circles, errors and version', async () => {
    const project = createProject('ANNA\nA-1', 55, 3.4);
    const workerResult = await processStoneBatchProject(project, { loadFont: async () => font });
    const validation = validateInput(project.input, { heightMm: project.heightMm, holeDiameterMm: project.diameterMm });
    const direct = generateRhinestoneBatch(
      validation.rows.map((row) => createTextGeometry(font, row.normalizedText, 55)),
      3.4,
    );

    expect(workerResult.validation).toEqual(validation);
    expect(workerResult.batch).toEqual(direct);
    expect(workerResult.batch?.rows[0]).toMatchObject({
      nominalHeightMm: 55,
      diameterMm: 3.4,
      engineVersion: direct.engineVersion,
    });
  });

  it('reports incremental progress for ten rows without changing the direct geometry', async () => {
    const progress: WorkerProgress[] = [];
    const result = await processStoneBatchProject(
      createProject(rowsOf('ANNA', 10), 45, 3.2),
      { loadFont: async () => font },
      (update) => progress.push(update),
    );

    expect(progress[0]).toEqual({ completedRows: 0, totalRows: 10, fraction: 0 });
    expect(progress.at(-1)).toEqual({ completedRows: 10, totalRows: 10, fraction: 1 });
    expect(result.batch?.rows).toHaveLength(10);
  });

  it('returns progress and the final result using exactly the request ID', async () => {
    const request = { type: 'run' as const, id: 42, project: createProject('ANNA', 45, 3.2) };
    const messages: StoneBatchWorkerResponse[] = [];

    await handleWorkerRequest(request, { loadFont: async () => font }, (message) => messages.push(message));

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.id === request.id)).toBe(true);
    expect(messages.at(-1)).toMatchObject({ type: 'success', id: 42 });
  });

  it('can process a valid maximum batch of thirty rows', async () => {
    const result = await runProject(rowsOf('ANNA', 30), 45, 3.2);

    expect(result.validation.valid).toBe(true);
    expect(result.batch?.rows).toHaveLength(30);
    expect(result.batch?.totalCircleCount).toBeGreaterThan(0);
  });

  it('preserves a geometric preflight failure as a successful local calculation result', async () => {
    const result = await runProject('WWWW', 55, 3.2);

    expect(result.validation.valid).toBe(true);
    expect(result.batch?.valid).toBe(false);
    expect(result.batch?.rows[0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDTH_LIMIT_EXCEEDED' }),
    ]));
  });

  it('returns validation failures without loading a font or sending data over the network', async () => {
    let fontLoads = 0;
    const result = await processStoneBatchProject(
      createProject('José', 45, 3.2),
      {
        loadFont: async () => {
          fontLoads += 1;
          return font;
        },
      },
    );

    expect(result.validation.valid).toBe(false);
    expect(result.batch).toBeNull();
    expect(fontLoads).toBe(0);
  });

  it('keeps names and geometry off the network: the Worker only delegates local font loading', () => {
    const workerSource = readFileSync(WORKER_SOURCE_PATH, 'utf8');

    expect(FONT_ASSET_URL).toMatch(/^\//);
    expect(workerSource).toContain('loadMontserratBlack');
    expect(workerSource).not.toMatch(/\bfetch\s*\(/);
    expect(workerSource).not.toContain('XMLHttpRequest');
  });
});

async function runProject(input: string, heightMm: number, diameterMm: number) {
  return processStoneBatchProject(createProject(input, heightMm, diameterMm), { loadFont: async () => font });
}

function createProject(input: string, heightMm: number, diameterMm: number): StoneBatchWorkerProject {
  return { schemaVersion: WORKER_PROJECT_SCHEMA_VERSION, input, heightMm, diameterMm };
}

function rowsOf(text: string, count: number): string {
  return Array.from({ length: count }, () => text).join('\n');
}
