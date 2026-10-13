/**
 * Blind listening of SoundFonts (ARQUITECTURA.md, 7.2; H2): the same passages of Dilatación with
 * every candidate in recursos/soundfonts, in random order and unnamed, rated 1–5. The choice of
 * sound becomes a decision by ear, not by catalogue. Results go to the app log.
 */
import { importMidi } from "@fourhands/core";
import { Engine, LookaheadPlayer } from "../audio/engine.js";
import { langFrom, translator } from "../shared/i18n.js";
import { installTheme } from "../renderer/theme.js";
import dilatacion from "../../../core/test-data/Dilatacion.mid";
import { FRAGMENTS, type Fragment, fragmentEvents, shuffle } from "./fragments.js";

interface Candidate {
  index: number;
  name: string;
}

interface Api {
  info(): Promise<{ locale: string }>;
  sfList(): Promise<Candidate[]>;
  sfLoad(index: number): Promise<ArrayBuffer | null>;
  log(entry: Record<string, unknown>): void;
}

const fh = (window as unknown as { fh: Api }).fh;
const song = importMidi(dilatacion).song;
const engines = new Map<number, Engine>();
let player: LookaheadPlayer | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

async function engineFor(c: Candidate, status: HTMLElement, t: ReturnType<typeof translator>): Promise<Engine | null> {
  const ready = engines.get(c.index);
  if (ready) return ready;
  status.textContent = t("blindLoading", { name: "…" });
  const sf = await fh.sfLoad(c.index);
  if (!sf) return null;
  const engine = new Engine();
  await engine.init(sf, "worklet.js", false);
  engines.set(c.index, engine);
  status.textContent = "";
  return engine;
}

function stopAll(): void {
  player?.stop();
  player = null;
  for (const e of engines.values()) e.panic();
}

async function start(): Promise<void> {
  installTheme();
  const t = translator(langFrom((await fh.info()).locale));
  document.title = t("blindTitle");
  const root = document.getElementById("root")!;
  const candidates = await fh.sfList();
  root.append(el("h1", {}, t("blindTitle")), el("p", { className: "hint" }, t("blindIntro")));
  if (candidates.length < 2) {
    root.append(el("p", {}, t("blindNone")));
    return;
  }
  const ratings = new Map<string, number>(); // `${fragment}:${candidate}` → 1..5
  const box = el("div", { className: "card" });
  const status = el("p", { className: "hint" });
  root.append(box, status);

  const showFragment = (k: number) => {
    stopAll();
    box.replaceChildren();
    const f: Fragment = FRAGMENTS[k]!;
    const name = f.id === "piano" ? t("blindPiano") : t("blindStrings");
    box.append(el("p", { className: "ah" }, t("blindFragment", { n: k + 1, total: FRAGMENTS.length, name })));
    const order = shuffle(candidates);
    const passage = fragmentEvents(song, f);
    order.forEach((c, i) => {
      const letter = String.fromCharCode(65 + i);
      const play = el("button", { className: "btn" }, t("blindPlay"));
      play.onclick = async () => {
        stopAll();
        const engine = await engineFor(c, status, t);
        if (!engine) return;
        for (const ev of passage.setup) engine.now(ev);
        player = new LookaheadPlayer(engine);
        player.play(passage.events);
      };
      const stars = el("span", { className: "stars" });
      for (let r = 1; r <= 5; r++) {
        const b = el("button", { className: "star" }, String(r));
        b.setAttribute("aria-pressed", "false");
        b.onclick = () => {
          ratings.set(`${f.id}:${c.index}`, r);
          for (const s of stars.children) s.setAttribute("aria-pressed", String(Number(s.textContent) === r));
        };
        stars.append(b);
      }
      box.append(el("div", { className: "row" }, el("span", { className: "letter mono" }, letter), play, stars));
    });
    const stop = el("button", { className: "btn" }, t("blindStop"));
    stop.onclick = stopAll;
    const last = k === FRAGMENTS.length - 1;
    const next = el("button", { className: "btn pri" }, last ? t("blindFinish") : t("blindNext"));
    next.onclick = () => {
      if (candidates.some((c) => !ratings.has(`${f.id}:${c.index}`))) {
        status.textContent = t("blindRateAll");
        return;
      }
      status.textContent = "";
      if (last) showResults();
      else showFragment(k + 1);
    };
    box.append(el("div", { className: "row end" }, stop, next));
  };

  const showResults = () => {
    stopAll();
    box.replaceChildren(el("p", { className: "ah" }, t("blindResults")));
    const results = candidates
      .map((c) => {
        const scores = FRAGMENTS.map((f) => ratings.get(`${f.id}:${c.index}`) ?? 0);
        return { name: c.name, scores, average: scores.reduce((a, b) => a + b, 0) / scores.length };
      })
      .sort((a, b) => b.average - a.average);
    const table = el("table");
    table.append(el("tr", {}, el("th", {}, ""), ...FRAGMENTS.map((f) => el("th", {}, f.id === "piano" ? t("blindPiano") : t("blindStrings")))));
    for (const r of results) table.append(el("tr", {}, el("td", {}, r.name), ...r.scores.map((s) => el("td", { className: "mono" }, String(s)))));
    box.append(table, el("p", { className: "hint" }, t("blindSaved")));
    fh.log({ type: "blind_listening", results });
  };

  showFragment(0);
}

void start();
