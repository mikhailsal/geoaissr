export interface ClockSample {
  rttMs: number;
  offsetMs: number;
  clientRecvMs: number;
}

const MAX_SAMPLES = 5;
const SPIKE_THRESHOLD_MS = 15_000;
const JUMP_MATCH_TOLERANCE_MS = 3_000;

export class ServerClock {
  private samples: ClockSample[] = [];
  private fallbackOffsetMs = 0;
  private pendingJump: ClockSample | null = null;
  private lastRttMs: number | null = null;

  seed(serverNow: number, clientNow = Date.now()): void {
    if (this.samples.length === 0) {
      this.fallbackOffsetMs = serverNow - clientNow;
    }
  }

  recordPong(serverNow: number, clientSentMs: number, clientRecvMs = Date.now()): void {
    const rttMs = Math.max(0, clientRecvMs - clientSentMs);
    this.lastRttMs = rttMs;
    const offsetMs = serverNow + rttMs / 2 - clientRecvMs;
    const sample: ClockSample = { rttMs, offsetMs, clientRecvMs };

    if (this.samples.length >= 2) {
      const currentOffset = this.getOffsetMs();
      if (Math.abs(offsetMs - currentOffset) > SPIKE_THRESHOLD_MS) {
        if (
          this.pendingJump &&
          Math.abs(offsetMs - this.pendingJump.offsetMs) <= JUMP_MATCH_TOLERANCE_MS
        ) {
          this.samples = [this.pendingJump, sample];
          this.pendingJump = null;
        } else {
          this.pendingJump = sample;
        }
        return;
      }
    }

    this.pendingJump = null;
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  getOffsetMs(): number {
    const first = this.samples[0];
    if (!first) {
      return this.fallbackOffsetMs;
    }
    let best = first;
    for (const sample of this.samples) {
      if (sample.rttMs < best.rttMs) {
        best = sample;
      }
    }
    return best.offsetMs;
  }

  getLastRttMs(): number | null {
    return this.lastRttMs;
  }

  now(clientNow = Date.now()): number {
    return clientNow + this.getOffsetMs();
  }

  remainingMs(endsAt: number, clientNow = Date.now()): number {
    return Math.max(0, endsAt - this.now(clientNow));
  }
}
