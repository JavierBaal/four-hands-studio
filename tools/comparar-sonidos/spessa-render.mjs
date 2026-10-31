// Renders a MIDI file with SpessaSynth (as the app's worklet: effects on) to a 24-bit WAV.
import fs from "node:fs";
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from "spessasynth_core";

const [bankPath, midiPath, wavPath] = process.argv.slice(2);
const rate = 48000;
const BLOCK = 128;
const bank = SoundBankLoader.fromArrayBuffer(fs.readFileSync(bankPath).buffer);
const synth = new SpessaSynthProcessor(rate, { maxBufferSize: BLOCK, effectsEnabled: true });
synth.soundBankManager.addSoundBank(bank, "main");
await synth.processorInitialized;
const midi = BasicMIDI.fromArrayBuffer((b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))(fs.readFileSync(midiPath)));
const seq = new SpessaSynthSequencer(synth);
seq.loadNewSongList([midi]);
seq.loop = false;
seq.play();
const seconds = midi.duration + 3;
const total = Math.ceil(seconds * rate / BLOCK) * BLOCK;
const L = new Float32Array(total), R = new Float32Array(total);
for (let i = 0; i < total; i += BLOCK) {
  seq.processTick();
  synth.process(L, R, i, BLOCK);
}
let sum = 0, peak = 0;
for (const x of L) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
console.log("rms", Math.sqrt(sum / total), "peak", peak, "dur", seconds);
const buf = Buffer.alloc(44 + total * 6);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + total * 6, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24);
buf.writeUInt32LE(rate * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34); buf.write("data", 36); buf.writeUInt32LE(total * 6, 40);
let o = 44;
for (let i = 0; i < total; i++) for (const ch of [L, R]) { const v = Math.max(-8388608, Math.min(8388607, Math.round(ch[i] * 8388607))); buf.writeIntLE(v, o, 3); o += 3; }
fs.writeFileSync(wavPath, buf);
