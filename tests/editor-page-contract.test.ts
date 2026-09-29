import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/scripts/stonebatch-editor.ts', import.meta.url), 'utf8');

describe('T08 editor page contract', () => {
  it('ships the required English entry controls and disabled commercial CTA', () => {
    expect(page).toContain('Turn your name list into matching SS10 rhinestone SVG templates.');
    expect(page).toContain('Preview every name. Test one free. Export up to 30 together for €9.90 — 7-day access, no subscription.');
    expect(page).toContain('id="name-list"');
    expect(page).toContain('id="height-mm"');
    expect(page).toContain('id="diameter-mm"');
    expect(page).toContain('id="export-all"');
    expect(page).toContain('disabled');
    expect(page).toContain('No automatic renewal.');
    expect(page).toContain('14-day self-service refund.');
  });

  it('uses the existing Worker client and safe DOM construction without sending project data over the network', () => {
    expect(editor).toContain('StoneBatchWorkerClient');
    expect(editor).toContain('client.run(project)');
    expect(editor).toContain('client.retry()');
    expect(editor).not.toContain('innerHTML');
    expect(editor).not.toContain('fetch(');
    expect(editor).not.toContain('XMLHttpRequest');
  });

  it('keeps stale previews non-downloadable and builds previews from T04 circles', () => {
    expect(editor).toContain('download.disabled = !current');
    expect(editor).toContain('createCirclePreview');
    expect(editor).toContain("createElementNS('http://www.w3.org/2000/svg', 'circle')");
    expect(editor).toContain('getFirstFreeSvg');
    expect(editor).toContain('commercialButton.disabled = !isCommercialExportEnabled');
    expect(editor).toContain("commercialButton.addEventListener('click'");
  });
});
