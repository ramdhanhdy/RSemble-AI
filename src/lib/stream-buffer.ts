// =============================================================================
// Stream delta buffer — batches token deltas and flushes via requestAnimationFrame.
// Prevents one React root dispatch per token during streaming.
// =============================================================================

export type FlushCallback = (id: string, delta: string) => void;

export class StreamDeltaBuffer {
  private buffers = new Map<string, string>();
  private rafId: number | null = null;
  private onFlush: FlushCallback;

  constructor(onFlush: FlushCallback) {
    this.onFlush = onFlush;
  }

  push(id: string, delta: string): void {
    const existing = this.buffers.get(id) ?? "";
    this.buffers.set(id, existing + delta);
    this.schedule();
  }

  private schedule(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.flush();
    });
  }

  flush(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.buffers.size === 0) return;
    for (const [id, delta] of this.buffers) {
      this.onFlush(id, delta);
    }
    this.buffers.clear();
  }

  cancel(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.buffers.clear();
  }
}

/** Create a buffer and a stable push function. */
export function createStreamDeltaBuffer(onFlush: FlushCallback) {
  const buffer = new StreamDeltaBuffer(onFlush);
  return {
    push: (id: string, delta: string) => buffer.push(id, delta),
    flush: () => buffer.flush(),
    cancel: () => buffer.cancel(),
  };
}
