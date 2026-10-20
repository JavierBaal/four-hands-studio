/**
 * Activity panel and its folded rail (DIRECCION_ARTISTICA.md, 6.1 item 7 and 6.2):
 * what the AI sees, proposals, signed history and active skills.
 * Proposals arrive with H4; until then their empty state explains them. Skills: SkillsPanel.tsx.
 */
import type { HistoryEntry, Song } from "@fourhands/core";
import type { Translate } from "../../shared/i18n.js";
import { activeTrack, useApp, useClock, useSong, useView } from "../context.js";
import { barRange, shortPosition } from "../music.js";
import { ActiveSkills } from "./SkillsPanel.js";
import { ChevronLeft, ChevronRight, EyeIcon, HistoryIcon, ProposalIcon } from "./Icons.js";

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

export function ActivityPanel() {
  const { t, view, replica } = useApp();
  const song = useSong();
  const now = useClock(30_000);
  const track = activeTrack(song);
  const loop = song.context.loop;
  const history = [...replica.history].reverse().slice(0, 30);
  return (
    <aside className="activity" aria-label={t("activity")}>
      <div className="phead">
        <span className="ptitle">{t("activity")}</span>
        <button className="ibtn" onClick={() => view.set({ panelOpen: false })} aria-label={t("foldPanel")} title={t("foldPanel")}>
          <ChevronRight />
        </button>
      </div>
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
      <div>
        <p className="ah">{t("proposals")}</p>
        <p className="hint">{t("noProposals")}</p>
      </div>
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
    </aside>
  );
}

export function Rail() {
  const { t, view } = useApp();
  const v = useView();
  const open = () => view.set({ panelOpen: true });
  return (
    <nav className="rail" aria-label={t("activity")}>
      <button className="ibtn rexp" onClick={open} aria-label={t("unfoldPanel")} title={t("unfoldPanel")}>
        <ChevronLeft />
      </button>
      <button className="ibtn" onClick={open} aria-label={t("aiSeesTitle")} title={t("aiSeesTitle")}>
        <EyeIcon />
      </button>
      <button className="ibtn" onClick={open} aria-label={t("proposals")} title={t("proposals")}>
        <ProposalIcon />
      </button>
      <button className="ibtn" onClick={open} aria-label={t("history")} title={t("history")}>
        <HistoryIcon />
      </button>
      {void v}
    </nav>
  );
}
