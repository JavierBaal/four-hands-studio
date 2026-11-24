/**
 * Export (F2.4): the MP3 is made from the engine's WAV. LAME (LGPL-3.0) is loaded from a file of
 * its own (dist/lame/lamejs.mjs), never bundled into the app, so it can be replaced
 * (THIRD_PARTY_NOTICES.md). Here: reading the WAV, the ID3 tag and the encoding loop, with the
 * encoder passed in.
 */

export interface Pcm {
  rate: number;
  bits: number;
  channels: number;
  /** Samples per channel. */
  frames: number;
  left: Int16Array;
  right: Int16Array;
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** A PCM WAV (16 or 24 bit, mono or stereo) as 16-bit samples for the encoder. */
export function readWav(bytes: Uint8Array): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WAVE") throw new Error("Not a WAV file");
  let rate = 0;
  let bits = 0;
  let channels = 0;
  let data: { at: number; size: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = fourcc(bytes, at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      const tag = view.getUint16(at + 8, true);
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
      // 1: PCM; 0xFFFE: extensible, whose subformat starts with the same tag.
      const sub = tag === 0xfffe && size >= 26 ? view.getUint16(at + 32, true) : tag;
      if (sub !== 1) throw new Error("Only PCM WAV files can be converted");
    } else if (id === "data") {
      data = { at: at + 8, size: Math.min(size, bytes.length - at - 8) };
      break;
    }
    at += 8 + size + (size & 1);
  }
  if (!data || !rate || (bits !== 16 && bits !== 24) || (channels !== 1 && channels !== 2)) throw new Error("Unsupported WAV file");
  const step = (bits / 8) * channels;
  const frames = Math.floor(data.size / step);
  const left = new Int16Array(frames);
  const right = new Int16Array(frames);
  const sample = (at: number): number => {
    if (bits === 16) return view.getInt16(at, true);
    // 24 bit to 16, rounded: the MP3 encoder takes 16.
    const v = (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)) << 8 >> 8;
    return Math.max(-32768, Math.min(32767, Math.round(v / 256)));
  };
  for (let i = 0, at = data.at; i < frames; i++, at += step) {
    left[i] = sample(at);
    right[i] = channels === 2 ? sample(at + bits / 8) : left[i]!;
  }
  return { rate, bits, channels, frames, left, right };
}

/** An ID3v2.3 tag with the title, the artist and the program (UTF-16 text). */
export function id3Tag(fields: { title?: string; artist?: string; software?: string }): Uint8Array {
  const frames: Uint8Array[] = [];
  const frame = (id: string, text: string | undefined) => {
    if (!text) return;
    // Encoding 1: UTF-16 with a byte order mark, little-endian.
    const body = new Uint8Array(1 + 2 + text.length * 2 + 2);
    body[0] = 1;
    body[1] = 0xff;
    body[2] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      body[3 + i * 2] = c & 0xff;
      body[4 + i * 2] = c >> 8;
    }
    const head = new Uint8Array(10);
    for (let i = 0; i < 4; i++) head[i] = id.charCodeAt(i);
    new DataView(head.buffer).setUint32(4, body.length);
    frames.push(head, body);
  };
  frame("TIT2", fields.title);
  frame("TPE1", fields.artist);
  frame("TSSE", fields.software);
  const size = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + size);
  out.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
  // Size without the header, 7 bits per byte (syncsafe).
  out[6] = (size >> 21) & 0x7f;
  out[7] = (size >> 14) & 0x7f;
  out[8] = (size >> 7) & 0x7f;
  out[9] = size & 0x7f;
  let at = 10;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/** lamejs gives Int8Arrays (its types say Uint8Array): copied as bytes, its buffer is reused. */
const bytesOf = (a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();

export interface Mp3EncoderLike {
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
  flush(): Uint8Array;
}

/**
 * The MP3's bytes, in pieces: the tag first, then the frames. `progress` gets 0–1; `cancelled`
 * stops between pieces.
 */
export function encodeMp3(
  pcm: Pcm,
  encoder: Mp3EncoderLike,
  tag: Uint8Array,
  progress?: (fraction: number) => void,
  cancelled?: () => boolean,
): Uint8Array[] | null {
  const parts: Uint8Array[] = [tag];
  // A multiple of the 1152 samples of an MP3 frame.
  const piece = 1152 * 40;
  for (let i = 0; i < pcm.frames; i += piece) {
    if (cancelled?.()) return null;
    const end = Math.min(pcm.frames, i + piece);
    const out = pcm.channels === 2 ? encoder.encodeBuffer(pcm.left.subarray(i, end), pcm.right.subarray(i, end)) : encoder.encodeBuffer(pcm.left.subarray(i, end));
    if (out.length) parts.push(bytesOf(out));
    progress?.(end / pcm.frames);
  }
  const last = encoder.flush();
  if (last.length) parts.push(bytesOf(last));
  return parts;
}
