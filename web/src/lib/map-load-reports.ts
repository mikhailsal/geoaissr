export type MapLoadKind = 'guess' | 'results';

/**
 * Tracks which map loads the server has been told about. A map reports once per page load, so a
 * report that could not be sent (the socket was down) is kept and retried, not forgotten.
 */
export class MapLoadReporter {
  private readonly send: (kind: MapLoadKind) => boolean;
  private readonly sent = new Set<MapLoadKind>();
  private readonly pending = new Set<MapLoadKind>();

  /** `send` returns true when the socket took the report. */
  constructor(send: (kind: MapLoadKind) => boolean) {
    this.send = send;
  }

  report(kind: MapLoadKind): void {
    if (this.sent.has(kind)) return;
    // Count a kind as sent only once the socket took it; otherwise keep it for the next connection.
    if (this.send(kind)) {
      this.sent.add(kind);
      this.pending.delete(kind);
    } else {
      this.pending.add(kind);
    }
  }

  /** Re-sends reports that were made while the socket was down. */
  flushPending(): void {
    for (const kind of [...this.pending]) this.report(kind);
  }

  /** A new session starts from scratch: nothing sent, nothing pending. */
  reset(): void {
    this.sent.clear();
    this.pending.clear();
  }
}
