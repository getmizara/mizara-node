import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface QueuedReceipt {
  receiptId: string;
  payload: Record<string, unknown>;
}

type LogEntry = { type: 'pending'; receiptId: string; payload: Record<string, unknown> } | { type: 'ack'; receiptId: string };

// Write-ahead log for receipts awaiting delivery to the hosted API. A
// receipt is appended as "pending" before a flush is attempted and
// appended again as "ack" once the server confirms it. If the process
// crashes between those two writes, loadUnacked() on the next startup
// returns it so it can be retried - a receipt is never silently lost to
// a crash between the decision and the network flush.
export class ReceiptLog {
  constructor(private readonly path: string) {}

  appendPending(entry: QueuedReceipt): void {
    this.appendLine({ type: 'pending', receiptId: entry.receiptId, payload: entry.payload });
  }

  appendAck(receiptId: string): void {
    this.appendLine({ type: 'ack', receiptId });
  }

  loadUnacked(): QueuedReceipt[] {
    if (!existsSync(this.path)) return [];

    const pending = new Map<string, QueuedReceipt>();
    const acked = new Set<string>();

    for (const line of this.readLines()) {
      if (line.type === 'pending') pending.set(line.receiptId, { receiptId: line.receiptId, payload: line.payload });
      else acked.add(line.receiptId);
    }

    return [...pending.values()].filter((entry) => !acked.has(entry.receiptId));
  }

  // Rewrites the log to contain only unresolved entries, dropping acked
  // history so the file doesn't grow without bound.
  compact(): void {
    const unacked = this.loadUnacked();
    const lines = unacked.map((entry) => JSON.stringify({ type: 'pending', ...entry }));
    writeFileSync(this.path, lines.length ? lines.join('\n') + '\n' : '');
  }

  private appendLine(entry: LogEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
  }

  private readLines(): LogEntry[] {
    return readFileSync(this.path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEntry);
  }
}
