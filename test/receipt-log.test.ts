import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReceiptLog } from '../src/sdk/receipt-log';

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mizara-receipt-log-'));
  logPath = join(dir, 'receipts.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ReceiptLog', () => {
  it('returns nothing when the log file does not exist yet', () => {
    const log = new ReceiptLog(logPath);
    expect(log.loadUnacked()).toEqual([]);
  });

  it('returns a pending entry that was never acked', () => {
    const log = new ReceiptLog(logPath);
    log.appendPending({ receiptId: 'rcpt_1', payload: { status: 'DENY' } });

    expect(log.loadUnacked()).toEqual([{ receiptId: 'rcpt_1', payload: { status: 'DENY' } }]);
  });

  it('excludes an entry once it has been acked', () => {
    const log = new ReceiptLog(logPath);
    log.appendPending({ receiptId: 'rcpt_1', payload: { status: 'DENY' } });
    log.appendAck('rcpt_1');

    expect(log.loadUnacked()).toEqual([]);
  });

  it('simulates a crash between the decision and the flush: entry survives for a new ReceiptLog instance pointed at the same file', () => {
    const writer = new ReceiptLog(logPath);
    writer.appendPending({ receiptId: 'rcpt_crash', payload: { status: 'ALLOW' } });
    // No appendAck call - simulates the process dying before the flush completed.

    const reader = new ReceiptLog(logPath);
    expect(reader.loadUnacked()).toEqual([{ receiptId: 'rcpt_crash', payload: { status: 'ALLOW' } }]);
  });

  it('compact() drops acked history but keeps unacked entries', () => {
    const log = new ReceiptLog(logPath);
    log.appendPending({ receiptId: 'rcpt_done', payload: { status: 'ALLOW' } });
    log.appendAck('rcpt_done');
    log.appendPending({ receiptId: 'rcpt_pending', payload: { status: 'DENY' } });

    log.compact();

    expect(log.loadUnacked()).toEqual([{ receiptId: 'rcpt_pending', payload: { status: 'DENY' } }]);
  });

  it('compact() on an all-acked log leaves an empty (but existing) file', () => {
    const log = new ReceiptLog(logPath);
    log.appendPending({ receiptId: 'rcpt_1', payload: {} });
    log.appendAck('rcpt_1');

    log.compact();

    expect(existsSync(logPath)).toBe(true);
    expect(log.loadUnacked()).toEqual([]);
  });
});
