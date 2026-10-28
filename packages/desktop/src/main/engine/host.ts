/**
 * Starts the native engine (engine/, a separate process: if a plugin crashes it, Four Hands stays
 * alive) and talks to it over the local link (framing.ts). Every request that has a reply gets it
 * in order, so a queue matches them; "scanning" messages are progress, not replies.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { ENGINE_OFF, type EngineStatus } from "../../shared/engine.js";
import { FrameReader, frame } from "./framing.js";

type Reply = Record<string, unknown> & { type: string };

export interface EngineHostOptions {
  /** The engine's command: the executable, plus any leading arguments (tests). Null: not here. */
  command: () => string[] | null;
  /** Where the engine keeps the list of plugins it found (so it does not scan every time). */
  cacheFile: string;
  log: (entry: Record<string, unknown>) => void;
  onStatus?: (status: EngineStatus) => void;
  onScanning?: (file: string) => void;
  /** How long the engine has to say it is ready. */
  startTimeoutMs?: number;
}

export class EngineError extends Error {}

/** Lines of the engine's own output kept in the log per run. */
const CHATTER_LOGGED = 5;

/** A port nobody is using now, for the engine to listen on. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export class EngineHost {
  private status: EngineStatus = { ...ENGINE_OFF };
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private starting: Promise<void> | null = null;
  private waiting: Array<{ resolve: (r: Reply) => void; reject: (e: Error) => void; request: string }> = [];
  private stopping = false;
  /** While starting: gives up (the process ended before it was ready). */
  private abortStart: ((why: string) => void) | null = null;
  private chatterLines = 0;

  constructor(private readonly options: EngineHostOptions) {}

  get current(): EngineStatus {
    return { ...this.status };
  }

  private setStatus(changes: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...changes };
    this.options.onStatus?.(this.current);
  }

  /** Starts the engine if it is not running; resolves when it is ready. */
  start(): Promise<void> {
    if (this.status.state === "ready" && this.socket) return Promise.resolve();
    this.starting ??= this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  private async launch(): Promise<void> {
    const command = this.options.command();
    if (!command || command.length === 0) {
      this.setStatus({ state: "missing", error: "The engine is not built on this computer" });
      throw new EngineError("The engine is not built on this computer");
    }
    this.stopping = false;
    this.setStatus({ state: "starting", error: undefined, device: undefined });
    const token = randomBytes(16).toString("hex");
    // Four Hands chooses the port: on Windows the engine is a window app and its printed lines
    // may not reach us, so nothing depends on reading them (they only go to the log).
    const port = await freePort();
    const [file, ...lead] = command;
    const started = Date.now();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        this.abortStart = null;
        clearTimeout(timer);
        this.options.log({ type: "engine_failed", error: message });
        this.kill();
        this.setStatus({ state: "failed", error: message });
        reject(new EngineError(message));
      };
      this.abortStart = fail;
      const timer = setTimeout(() => fail("The engine did not start in time"), this.options.startTimeoutMs ?? 20000);
      let child: ChildProcess;
      try {
        child = spawn(file!, [...lead, "--port", String(port), "--token", token, "--cache", this.options.cacheFile], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        fail(`The engine could not start: ${String(error)}`);
        return;
      }
      this.child = child;
      child.on("error", (error) => fail(`The engine could not start: ${error.message}`));
      child.on("exit", (code, signal) => this.exited(child, code, signal));
      child.stderr?.on("data", (d: Buffer) => this.chatter("engine_stderr", d.toString().slice(0, 500)));
      let out = "";
      child.stdout?.on("data", (d: Buffer) => {
        out += d.toString();
        let nl: number;
        while ((nl = out.indexOf("\n")) >= 0) {
          const line = out.slice(0, nl).trim();
          out = out.slice(nl + 1);
          if (line.startsWith("FH_ENGINE_ERROR")) fail(line.slice("FH_ENGINE_ERROR".length).trim());
          else if (line && !line.startsWith("FH_ENGINE_READY")) this.chatter("engine_out", line.slice(0, 300));
        }
      });
      // Knock until the engine opens the door (or gives up).
      const knock = () => {
        if (settled) return;
        this.connect(port, token).then(
          (hello) => {
            if (settled) return;
            settled = true;
            this.abortStart = null;
            clearTimeout(timer);
            const device = String(hello.device ?? "");
            const latency = Number(hello.latency ?? 0);
            const deviceError = hello.deviceError ? String(hello.deviceError) : undefined;
            this.options.log({ type: "engine_ready", ms: Date.now() - started, device, latency, sampleRate: hello.sampleRate, deviceError });
            this.setStatus({ state: "ready", device, latency, error: deviceError, generation: this.status.generation + 1 });
            resolve();
          },
          (error: Error & { refused?: boolean }) => (error.refused ? setTimeout(knock, 100) : fail(error.message)),
        );
      };
      setTimeout(knock, 100);
    });
  }

  private connect(port: number, token: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const reader = new FrameReader();
      socket.setNoDelay(true);
      socket.once("connect", () => {
        this.socket = socket;
        this.ask({ type: "hello", token }).then(resolve, reject);
      });
      socket.on("data", (chunk) => {
        let messages: unknown[];
        try {
          messages = reader.push(chunk);
        } catch (error) {
          this.options.log({ type: "engine_garbage", error: String(error) });
          socket.destroy();
          return;
        }
        for (const m of messages) this.received(m as Reply);
      });
      socket.on("error", (error: NodeJS.ErrnoException) => {
        // Not listening yet: the caller knocks again.
        const e = new EngineError(`Cannot reach the engine: ${error.message}`) as EngineError & { refused?: boolean };
        e.refused = this.socket !== socket && error.code === "ECONNREFUSED";
        reject(e);
      });
      socket.on("close", () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.rejectAll("The link with the engine closed");
      });
    });
  }

  /**
   * What the engine prints is mostly the plugins talking to themselves (Kontakt's memory messages,
   * Splice, Serato…): the first lines go to the log, the rest only counted (S2, Fran 28/10/2026).
   */
  private chatter(type: string, text: string): void {
    if (this.chatterLines < CHATTER_LOGGED) this.options.log({ type, text });
    this.chatterLines++;
  }

  private received(m: Reply): void {
    if (m.type === "scanning") {
      this.options.onScanning?.(String(m.file ?? ""));
      return;
    }
    const next = this.waiting.shift();
    if (!next) {
      this.options.log({ type: "engine_unexpected", message: m.type });
      return;
    }
    if (m.type === "error") next.reject(new EngineError(String(m.message ?? "Engine error")));
    else next.resolve(m);
  }

  private ask(message: Record<string, unknown>): Promise<Reply> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new EngineError("The engine is not running"));
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject, request: String(message.type) });
      socket.write(frame(message));
    });
  }

  /** A request with a reply; starts the engine first if needed. */
  async request(message: Record<string, unknown>): Promise<Reply> {
    await this.start();
    return this.ask(message);
  }

  /** A message without a reply (MIDI, panic). Dropped if the engine is not running. */
  send(message: Record<string, unknown>): boolean {
    if (!this.socket || this.status.state !== "ready") return false;
    this.socket.write(frame(message));
    return true;
  }

  private rejectAll(why: string): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) w.reject(new EngineError(why));
  }

  private exited(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    this.child = null;
    if (this.chatterLines > CHATTER_LOGGED) this.options.log({ type: "engine_chatter", lines: this.chatterLines, logged: CHATTER_LOGGED });
    this.chatterLines = 0;
    this.socket?.destroy();
    this.socket = null;
    this.rejectAll("The engine stopped");
    if (this.stopping) {
      this.setStatus({ state: "off", error: undefined });
      return;
    }
    // A plugin brought it down (or the system killed it): Four Hands goes on; the next request
    // starts it again and the window loads its plugins again (the generation changed).
    const error = `The engine stopped by itself (${signal ?? `code ${code}`})`;
    this.options.log({ type: "engine_exit", code, signal });
    if (this.status.state === "starting") this.abortStart?.(error);
    else this.setStatus({ state: "failed", error });
  }

  private kill(): void {
    this.socket?.destroy();
    this.socket = null;
    const child = this.child;
    if (child && child.exitCode === null) child.kill();
  }

  /** Closes the engine (the app is quitting). */
  stop(): void {
    if (!this.child) return;
    this.stopping = true;
    this.send({ type: "quit" });
    const child = this.child;
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 2000).unref();
  }
}
