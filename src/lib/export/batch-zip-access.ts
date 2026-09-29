/**
 * Deliberately separate from a future licence verifier. This module provides
 * only an explicit development/test switch for exercising T09 locally.
 */
export interface BatchZipAccess {
  readonly kind: 'dev-test' | 'unavailable';
  readonly authorized: boolean;
}

export const NO_BATCH_ZIP_ACCESS: BatchZipAccess = Object.freeze({
  kind: 'unavailable',
  authorized: false,
});

/**
 * This has no URL, storage, user input or licence path. The environment is
 * supplied by the build/test runtime rather than any caller-provided value.
 */
export function createDevTestBatchZipAccess(): BatchZipAccess {
  return import.meta.env.DEV || import.meta.env.MODE === 'test'
    ? Object.freeze({ kind: 'dev-test' as const, authorized: true })
    : NO_BATCH_ZIP_ACCESS;
}
