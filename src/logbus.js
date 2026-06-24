import { EventEmitter } from 'node:events';
import { parentPort, isMainThread } from 'node:worker_threads';

// In-memory, ring-buffered application log. Two jobs:
//  1. mirror everything to stdout so `docker logs` still works
//  2. keep the last N entries + emit events so the Logs page can show a live tail
//
// Worker threads (payslip prepare) have their own module instance and can't reach the
// main-thread buffer, so there they post each entry to the parent over parentPort and
// the main thread re-ingests it (see runPayslipJob in server.js).

const MAX_ENTRIES = 1000;
const buffer = [];
let seq = 0;

export const logEvents = new EventEmitter();
logEvents.setMaxListeners(0); // many SSE clients may subscribe

const VALID_LEVELS = new Set(['info', 'success', 'warn', 'error']);

function store(entry) {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  logEvents.emit('log', entry);
}

// Re-ingest an entry produced in a worker thread (already shaped, just needs a fresh seq).
export function ingest(entry) {
  const e = { ...entry, seq: ++seq };
  store(e);
  return e;
}

export function log(level, category, message) {
  const lvl = VALID_LEVELS.has(level) ? level : 'info';
  const msg = typeof message === 'string' ? message : JSON.stringify(message);
  const entry = { seq: 0, ts: new Date().toISOString(), level: lvl, category: String(category), message: msg };

  // Always mirror to stdout/stderr for docker logs.
  const line = `[${entry.category}] ${msg}`;
  if (lvl === 'error') console.error(line);
  else if (lvl === 'warn') console.warn(line);
  else console.log(line);

  if (!isMainThread && parentPort) {
    // Forward to the main thread, which owns the shared buffer.
    parentPort.postMessage({ __log: entry });
    return entry;
  }
  entry.seq = ++seq;
  store(entry);
  return entry;
}

// Return entries newer than `sinceSeq` (0 = everything currently buffered).
export function getRecent(sinceSeq = 0) {
  return sinceSeq > 0 ? buffer.filter((e) => e.seq > sinceSeq) : buffer.slice();
}

export const logInfo = (category, message) => log('info', category, message);
export const logSuccess = (category, message) => log('success', category, message);
export const logWarn = (category, message) => log('warn', category, message);
export const logError = (category, message) => log('error', category, message);
