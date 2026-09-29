import { CALIBRATION_INSTRUCTIONS, createCalibrationCoupons, type SvgDesignExport } from '../lib/export/svg-export';
import { validateInput } from '../lib/input/normalize';
import { createEditorProject, createPreviewRows, getCommercialEligibility, getFirstFreeSvg, isGeneratedPreviewCurrent, type EditorInputs, type GeneratedPreview, type PreviewRow } from '../lib/ui/editor-state';
import { StoneBatchWorkerClient } from '../lib/worker/worker-client';

const form = element<HTMLFormElement>('stonebatch-editor');
const input = element<HTMLTextAreaElement>('name-list');
const height = element<HTMLSelectElement>('height-mm');
const diameter = element<HTMLSelectElement>('diameter-mm');
const feedback = element<HTMLDivElement>('input-feedback');
const generate = element<HTMLButtonElement>('generate-previews');
const retry = element<HTMLButtonElement>('retry-generation');
const generationStatus = element<HTMLParagraphElement>('generation-status');
const previewFreshness = element<HTMLParagraphElement>('preview-freshness');
const previewResults = element<HTMLDivElement>('preview-results');
const measurement = element<HTMLParagraphElement>('browser-measurement');
const commercialButton = element<HTMLButtonElement>('export-all');
const commercialStatus = element<HTMLParagraphElement>('commercial-status');
const calibrationDownloads = element<HTMLDivElement>('calibration-downloads');
const client = new StoneBatchWorkerClient();
let generatedPreview: GeneratedPreview | null = null;
let activeProject: GeneratedPreview['project'] | null = null;
let generationStartedAt: number | null = null;

function getInputs(): EditorInputs { return { input: input.value, heightMm: Number(height.value), diameterMm: Number(diameter.value) }; }
function element<T extends HTMLElement>(id: string): T { const value = document.getElementById(id); if (!value) throw new Error(`Missing StoneBatch editor element: ${id}`); return value as T; }
function clear(node: HTMLElement): void { node.replaceChildren(); }
function appendText(node: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className?: string): HTMLElement { const child = document.createElement(tag); if (className) child.className = className; child.textContent = text; node.append(child); return child; }

function renderInputFeedback(): void {
  const values = getInputs(); const validation = validateInput(values.input, { heightMm: values.heightMm, holeDiameterMm: values.diameterMm }); clear(feedback);
  for (const row of validation.rows) if (row.originalText !== row.normalizedText && row.normalizedText.length > 0) appendText(feedback, 'p', `Row ${row.row} will generate as: ${row.normalizedText}`, 'feedback-normalized');
  for (const error of validation.errors) appendText(feedback, 'p', error.message, 'feedback-error');
}
function previewIsCurrent(): boolean { return generatedPreview !== null && isGeneratedPreviewCurrent(generatedPreview, getInputs()); }
function renderFreshness(): void {
  if (!generatedPreview) { previewFreshness.textContent = 'Generated previews will appear here in the same order as your list.'; previewFreshness.classList.remove('stale-note'); return; }
  previewFreshness.textContent = previewIsCurrent() ? 'Preview is current for the text and settings above.' : 'Preview is stale because the text or settings changed. Regenerate before downloading.';
  previewFreshness.classList.toggle('stale-note', !previewIsCurrent());
}
function renderPreviewRows(): void { clear(previewResults); renderFreshness(); renderCommercialState(); if (!generatedPreview) return; const current = previewIsCurrent(); createPreviewRows(generatedPreview.result).forEach((row) => previewResults.append(createPreviewCard(row, current))); }
function createPreviewCard(row: PreviewRow, current: boolean): HTMLElement {
  const card = document.createElement('article'); card.className = `preview-card${row.valid ? '' : ' preview-card-invalid'}`; const content = document.createElement('div'); const title = document.createElement('h3'); title.textContent = `${row.index}. ${row.normalizedText || 'Invalid row'}`; content.append(title);
  if (row.originalText !== row.normalizedText) appendText(content, 'p', `Original: ${row.originalText || '(empty)'}`, 'original-text');
  if (row.valid && row.design?.boundsMm) { content.append(createMetrics(row)); const freeExport = getFirstFreeSvg(generatedPreview!.result); if (freeExport && freeExport.text === row.design.text && freeExport.filename.startsWith(`${String(row.index).padStart(2, '0')}-`)) { const download = document.createElement('button'); download.type = 'button'; download.className = 'button button-secondary row-download'; download.textContent = 'Download first SVG — free'; download.disabled = !current; download.addEventListener('click', () => downloadSvg(freeExport)); content.append(download); } }
  else { const errors = document.createElement('ul'); errors.className = 'row-errors'; for (const error of row.errors) appendText(errors, 'li', error.message); content.append(errors); }
  const art = document.createElement('div'); art.className = 'preview-art'; if (row.valid && row.design?.boundsMm) art.append(createCirclePreview(row)); else appendText(art, 'p', 'This row cannot generate a preview.', 'field-help'); card.append(content, art); return card;
}
function createMetrics(row: PreviewRow): HTMLElement { const design = row.design!; const metrics = document.createElement('dl'); metrics.className = 'metrics'; const values: [string, string][] = [['Nominal height', `${design.nominalHeightMm} mm`], ['Physical width', `${formatMm(design.boundsMm!.width)} mm`], ['Physical height', `${formatMm(design.boundsMm!.height)} mm`], ['Hole diameter', `${design.diameterMm.toFixed(1)} mm`], ['Holes', String(design.circleCount)]]; for (const [label, value] of values) { appendText(metrics, 'dt', label); appendText(metrics, 'dd', value); } return metrics; }
function createCirclePreview(row: PreviewRow): SVGSVGElement { const design = row.design!; const bounds = design.boundsMm!; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${row.normalizedText} rhinestone hole preview`); for (const circle of design.circles) { const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); node.setAttribute('cx', String(circle.x)); node.setAttribute('cy', String(circle.y)); node.setAttribute('r', String(circle.diameterMm / 2)); node.setAttribute('fill', 'black'); svg.append(node); } return svg; }
function renderCommercialState(): void { if (!generatedPreview || !previewIsCurrent()) { commercialButton.disabled = true; commercialStatus.textContent = generatedPreview ? 'Regenerate the changed list or settings before the future batch export can be available.' : 'Generate at least two valid rows to make the future batch export available.'; return; } const eligibility = getCommercialEligibility(generatedPreview.result); commercialButton.disabled = true; commercialStatus.textContent = eligibility.eligible ? 'Your batch is eligible. Batch purchase and ZIP export are not available in this preview.' : eligibility.reason ?? 'Correct the listed errors before batch export can be available.'; }
function downloadSvg(exported: Pick<SvgDesignExport, 'filename' | 'svg'>): void { const url = URL.createObjectURL(new Blob([exported.svg], { type: 'image/svg+xml' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = exported.filename; anchor.click(); URL.revokeObjectURL(url); }
function renderCalibration(): void { const calibrationInstructions = element<HTMLUListElement>('calibration-instructions'); const cricutInstructions = element<HTMLUListElement>('cricut-instructions'); for (const text of CALIBRATION_INSTRUCTIONS.calibration) appendText(calibrationInstructions, 'li', text); for (const text of CALIBRATION_INSTRUCTIONS.cricut) appendText(cricutInstructions, 'li', text); for (const coupon of createCalibrationCoupons()) { const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = `Download calibration ${coupon.diameterMm.toFixed(1)} mm`; button.addEventListener('click', () => downloadSvg(coupon)); calibrationDownloads.append(button); } }
function startGeneration(): void { const project = createEditorProject(getInputs()); activeProject = project; generatedPreview = null; generationStartedAt = performance.now(); measurement.hidden = true; generate.textContent = 'Regenerate previews'; client.run(project); renderPreviewRows(); }
form.addEventListener('submit', (event) => { event.preventDefault(); startGeneration(); });
input.addEventListener('input', () => { renderInputFeedback(); renderPreviewRows(); }); height.addEventListener('change', () => { renderInputFeedback(); renderPreviewRows(); }); diameter.addEventListener('change', () => { renderInputFeedback(); renderPreviewRows(); });
retry.addEventListener('click', () => { generationStartedAt = performance.now(); generatedPreview = null; client.retry(); });
client.subscribe((state) => { if (state.status === 'running') { const progress = state.progress; generationStatus.textContent = progress ? `Generating previews: ${progress.completedRows} / ${progress.totalRows} rows complete.` : 'Starting local preview generation…'; retry.hidden = true; return; } if (state.status === 'error') { generationStatus.textContent = state.error?.message ?? 'Unable to calculate this design. Please try again.'; retry.hidden = false; return; } if (state.status === 'success' && state.result && activeProject) { generatedPreview = { project: activeProject, result: state.result }; const circleCount = state.result.batch?.totalCircleCount ?? 0; if (generationStartedAt !== null) { measurement.hidden = false; measurement.textContent = `Local browser timing: ${Math.round(performance.now() - generationStartedAt)} ms for ${state.result.validation.rows.length} rows and ${circleCount} holes.`; } generationStatus.textContent = previewIsCurrent() ? 'Previews generated locally in this browser.' : 'Previews finished, but the list or settings changed. Regenerate before downloading.'; retry.hidden = true; renderPreviewRows(); return; } generationStatus.textContent = 'Enter a list, then generate local previews.'; });
renderCalibration(); renderInputFeedback(); renderPreviewRows();
function formatMm(value: number): string { return value.toFixed(2); }
