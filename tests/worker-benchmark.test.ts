import { readFileSync } from 'node:fs';
import { arch, cpus, platform } from 'node:os';

import type { Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseMontserratBlack } from '../src/lib/engine/font-outlines';
import { processStoneBatchProject } from '../src/lib/worker/processor';
import { WORKER_PROJECT_SCHEMA_VERSION, type StoneBatchWorkerProject } from '../src/lib/worker/protocol';

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

describe('reproducible Worker-core benchmark', () => {
  it('reports 10- and 30-row measurements without using timing thresholds', async () => {
    const measurements = [];

    for (const rowCount of [10, 30]) {
      const startedAt = performance.now();
      const result = await processStoneBatchProject(project(rowsOf('ANNA', rowCount)), { loadFont: async () => font });
      measurements.push({
        rows: rowCount,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        totalCircleCount: result.batch?.totalCircleCount ?? 0,
      });
      expect(result.batch?.rows).toHaveLength(rowCount);
    }

    console.info(JSON.stringify({
      benchmark: 'stonebatch-worker-core',
      runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' },
      measurements,
    }));
  });
});

function project(input: string): StoneBatchWorkerProject {
  return { schemaVersion: WORKER_PROJECT_SCHEMA_VERSION, input, heightMm: 45, diameterMm: 3.2 };
}

function rowsOf(text: string, count: number): string {
  return Array.from({ length: count }, () => text).join('\n');
}
