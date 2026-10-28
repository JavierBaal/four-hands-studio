/**
 * The engine's message framing (engine/src/Link.h): JUCE's InterprocessConnection over TCP. Every
 * message is a 4-byte magic number, a 4-byte size (both little endian) and then the message, here
 * JSON in UTF-8.
 */
export const ENGINE_MAGIC = 0xf2b49e2c;
/** Larger than any reply we expect (a plugin list, a sampler's state); a bigger size means garbage. */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const head = Buffer.alloc(8);
  head.writeUInt32LE(ENGINE_MAGIC, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Collects bytes as they arrive and gives back whole messages. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  /** The messages completed by `chunk`. Throws if the stream is not the engine's. */
  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: unknown[] = [];
    while (this.buffer.length >= 8) {
      if (this.buffer.readUInt32LE(0) !== ENGINE_MAGIC) throw new Error("The engine sent something that is not a message");
      const size = this.buffer.readUInt32LE(4);
      if (size > MAX_MESSAGE_BYTES) throw new Error(`Engine message too large (${size} bytes)`);
      if (this.buffer.length < 8 + size) break;
      out.push(JSON.parse(this.buffer.subarray(8, 8 + size).toString("utf8")));
      this.buffer = this.buffer.subarray(8 + size);
    }
    return out;
  }
}
