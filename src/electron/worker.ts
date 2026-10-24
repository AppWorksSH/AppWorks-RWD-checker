import { Scanner } from '../core/scanner';
import { ScanStore } from '../core/storage';
import type { WorkerIn, WorkerOut } from '../shared/api';

const port = process.parentPort!;
let scanner: Scanner | null = null;

const send = (m: WorkerOut) => port.postMessage(m);

port.on('message', async ({ data }: { data: WorkerIn }) => {
  if (data.type === 'cancel') {
    scanner?.cancel();
    return;
  }
  if (data.type !== 'start' || scanner) return;
  try {
    scanner = new Scanner({
      options: data.options,
      store: new ScanStore(data.storeDir),
      resumeId: data.resumeId,
      id: data.id,
      onEvent: (event) => send({ type: 'event', event }),
    });
    const result = await scanner.run();
    send({ type: 'done', meta: result.meta });
  } catch (e) {
    send({ type: 'error', message: (e as Error).message });
  }
  setTimeout(() => process.exit(0), 200);
});
