import { loadMontserratBlack } from '../lib/engine/font-outlines';
import { handleWorkerRequest } from '../lib/worker/runtime';
import type {
  StoneBatchWorkerRequest,
  StoneBatchWorkerResponse,
} from '../lib/worker/protocol';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<StoneBatchWorkerRequest>) => void) | null;
  postMessage(message: StoneBatchWorkerResponse): void;
};

let cachedFont: ReturnType<typeof loadMontserratBlack> | null = null;

workerScope.onmessage = (event) => {
  void processRequest(event.data);
};

async function processRequest(request: StoneBatchWorkerRequest): Promise<void> {
  await handleWorkerRequest(request, { loadFont: loadCachedMontserratBlack }, (message) => workerScope.postMessage(message));
}

function loadCachedMontserratBlack(): ReturnType<typeof loadMontserratBlack> {
  cachedFont ??= loadMontserratBlack();
  return cachedFont;
}
