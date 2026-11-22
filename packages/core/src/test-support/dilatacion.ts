import { readFileSync } from "node:fs";

/** Dilatacion.mid, composed by Claude for the project: the H1 test file. */
export const DILATACION = new Uint8Array(readFileSync(new URL("../../test-data/Dilatacion.mid", import.meta.url)));
