/**
 * Activity panel and its folded rail (DIRECCION_ARTISTICA.md, 6.1 item 7 and 6.2):
 * the song concept, what the AI sees, the AI's last interventions, signed history and active skills.
 * H4 (Fran, 20/10/2026): the AI's changes go straight in, so the proposals section of sketch 01
 * becomes the AI's interventions: where it wrote and how much, "Ir", and "Con / Sin · B" on the
 * last one while it can still be compared. Skills: SkillsPanel.tsx.
 */
import type { HistoryEntry, Song } from "@fourhands/core";
import type { Translate } from "../../shared/i18n.js";
import { barAt, barStart } from "@fourhands/core";
import type { AiRecent } from "../../shared/protocol.js";
import { activeTrack, useAi, useApp, useClock, useSong, useView } from "../context.js";
import { barRange, shortPosition } from "../music.js";
import { ActiveSkills } from "./SkillsPanel.js";
import { ConceptCard } from "./Concept.js";
import { AiIcon, ChevronLeft, LibraryIcon, TrackIcon } from "./Icons.js";
import type { PanelTab } from "../view.js";

function ago(t: Translate, at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return t("now");
  if (min < 60) return t("minutesAgo", { n: min });
  return t("hoursAgo", { n: Math.floor(min / 60) });
}

function historyText(t: Translate, h: HistoryEntry): { who: string; what: string; ai: boolean } {
  const ai = h.actor.by === "ai";
  const who = ai ? t("aiName") : t("you");
  if (h.kind === "undo") return { who, what: t("undid", { label: h.label }), ai };
  if (h.kind === "redo") return { who, what: t("redid", { label: h.label }), ai };
  if (h.kind === "propose") return { who, what: t("proposedHist", { label: h.label }), ai };
  return { who, what: h.label, ai };
}

function selectionText(song: Song, t: Translate): string {
  const notes = song.context.selection.map((id) => song.notes[id]).filter((n) => n !== undefined);
  if (notes.length === 0) return t("nothing");
  const start = Math.min(...notes.map((n) => n.start));
  const end = Math.max(...notes.map((n) => n.start + n.duration));
  const count = notes.length === 1 ? t("oneNote") : t("notesCount", { n: notes.length });
  return `${t("bars", { range: barRange(song.meter, start, end) })} · ${count}`;
}

function recentMeta(t: Translate, song: Song, r: AiRecent, now: number): string {
  const parts: string[] = [];
  const tracks = r.trackIds.map((id) => song.tracks[id]?.name).filter(Boolean);
  if (tracks.length) parts.push(tracks.length > 2 ? t("ivTracks", { first: tracks[0]!, n: tracks.length - 1 }) : tracks.join(", "));
  if (r.start !== null && r.end !== null) parts.push(t("bars", { range: barRange(song.meter, r.start, r.end) }));
  const counts: string[] = [];
  if (r.added) counts.push(t("ivAdded", { n: r.added }));
  if (r.changed) counts.push(t("ivChanged", { n: r.changed }));
  if (r.removed) counts.push(t("ivRemoved", { n: r.removed }));
  if (counts.length) parts.push(t("ivNotes", { list: counts.join(", ") }));
  parts.push(ago(t, r.at, now));
  return parts.join(" · ");
}

/** The AI's last interventions on this song (H4), where the proposals of sketch 01 were. */
function AiInterventions({ now }: { now: number }) {
  const { t, view, replica } = useApp();
  const song = useSong();
  const ai = useAi();
  const recent = ai.recent ?? [];
  const comparable = replica.undo.lastAi;
  const goTo = (r: AiRecent) => {
    if (r.start === null) return;
    const bar = barAt(song.meter, r.start);
    view.animate({ startTick: Math.max(0, barStart(song.meter, Math.max(1, bar - 1))) }, 260);
    const track = r.trackIds.find((id) => song.tracks[id]);
    if (track && song.context.activeTrackId !== track) void replica.setContext({ activeTrackId: track });
  };
  return (
    <div className="aiivs">
      <p className="ah">{t("interventions")}</p>
      {recent.length === 0 ? (
        <p className="hint">{t("noInterventions")}</p>
      ) : (
        <ul className="ivlist">
          {recent.map((r, i) => (
            <li key={r.id} className="iv">
              <span className="dot ai" />
              <div className="ivbody">
                <div className="ivdesc">{r.description}</div>
                <div className="hwhen">{recentMeta(t, song, r, now)}</div>
                {i === 0 && comparable && (
                  <div className="ivcmp">
                    <span className="sees">{t("ivCompare")}</span>
                  </div>
                )}
              </div>
              {r.start !== null && (
                <button className="linkbtn ivgo" onClick={() => goTo(r)}>
                  {t("aiGo")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The IA tab of the side column: the activity panel of the sketches, unchanged. */
export function ActivityContent() {
  const { t, replica } = useApp();
  const song = useSong();
  const now = useClock(30_000);
  const track = activeTrack(song);
  const loop = song.context.loop;
  const history = [...replica.history].reverse().slice(0, 30);
  return (
    <>
      <ConceptCard />
      <div>
        <p className="ah">{t("aiSeesTitle")}</p>
        <div className="card ai">
          <div className="kv">
            <span>{t("track")}</span>
            <span>{track?.name ?? t("nothing")}</span>
          </div>
          <div className="kv">
            <span>{t("selection")}</span>
            <span className="mono">{selectionText(song, t)}</span>
          </div>
          <div className="kv">
            <span>{t("loop")}</span>
            <span className="mono">{loop ? t("bars", { range: barRange(song.meter, loop.start, loop.end) }) : t("nothing")}</span>
          </div>
          <div className="kv">
            <span>{t("cursor")}</span>
            <span className="mono">{shortPosition(song.meter, song.context.cursor)}</span>
          </div>
        </div>
      </div>
      <AiInterventions now={now} />
      <div>
        <p className="ah">{t("history")}</p>
        {history.length === 0 ? (
          <p className="hint">{t("noHistory")}</p>
        ) : (
          <ul className="hist">
            {history.map((h) => {
              const { who, what, ai } = historyText(t, h);
              return (
                <li key={h.revision} className="hi">
                  <span className={ai ? "dot ai" : "dot u"} />
                  <div>
                    <div>
                      <span className="hwho">{who}</span> {what}
                    </div>
                    <div className="hwhen">{ago(t, h.at, now)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ActiveSkills />
    </>
  );
}

/** The folded column: unfold it, or open it straight on one tab. */
export function Rail() {
  const { t, view } = useApp();
  const v = useView();
  const open = (tab: PanelTab) => view.set({ panelOpen: true, panelTab: tab, compactPanel: true, panelPeek: false });
  return (
    <nav className="rail" aria-label={t("sidePanel")}>
      <button className="ibtn rexp" onClick={() => view.set({ panelOpen: true })} aria-label={t("unfoldPanel")} title={t("unfoldPanel")}>
        <ChevronLeft />
      </button>
      <button className={v.compactPanel && v.panelTab === "track" ? "ibtn on" : "ibtn"} onClick={() => open("track")} aria-label={t("tabTrack")} title={`${t("tabTrack")} (F4)`}>
        <TrackIcon />
      </button>
      <button className={v.compactPanel && v.panelTab === "sounds" ? "ibtn on" : "ibtn"} onClick={() => open("sounds")} aria-label={t("tabSounds")} title={`${t("tabSounds")} (F5)`}>
        <LibraryIcon />
      </button>
      <button className={v.compactPanel && v.panelTab === "ai" ? "ibtn on aitab" : "ibtn aitab"} onClick={() => open("ai")} aria-label={t("tabAi")} title={`${t("tabAi")} (F6)`}>
        <AiIcon />
      </button>
    </nav>
  );
}
