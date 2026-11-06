// The pdf worker's entry point (spec §2): bootstrap only, excluded from coverage
// (implementation plan §1.3); the behaviour is in pdfWorkerApi.ts.
import { expose } from 'comlink';
import { pdfWorkerApi } from './pdfWorkerApi.ts';

expose(pdfWorkerApi);
