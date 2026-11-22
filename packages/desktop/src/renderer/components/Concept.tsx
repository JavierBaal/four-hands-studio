/**
 * The song concept at the top of the activity panel: the
 * intention and the limits, written by the user or the AI, with who wrote it. The AI reads it first
 * in get_song_overview and analyze checks a duration or tempo written in it.
 */
import { useEffect, useRef, useState } from "react";
import { useActions, useApp, useSong } from "../context.js";

export function ConceptCard() {
  const { t } = useApp();
  const actions = useActions();
  const song = useSong();
  const concept = song.concept;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const start = () => {
    setDraft(concept?.text ?? "");
    setEditing(true);
  };
  const save = () => {
    actions.setConcept(draft);
    setEditing(false);
  };

  return (
    <div className="concept">
      <p className="ah">{t("concept")}</p>
      {editing ? (
        <>
          <textarea
            ref={area}
            className="ctext"
            value={draft}
            rows={4}
            maxLength={1000}
            placeholder={t("conceptPlaceholder")}
            aria-label={t("concept")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <p className="hint ckeys">{t("conceptKeys")}</p>
        </>
      ) : concept ? (
        <div className="card cbody" onDoubleClick={start}>
          <p className="cline">{concept.text}</p>
          <div className="cmeta">
            <span className={concept.author.by === "ai" ? "dot ai" : "dot u"} />
            <span>{concept.author.by === "ai" ? t("conceptByAi", { name: t("aiName") }) : t("conceptByYou")}</span>
            <button className="linkbtn" onClick={start}>
              {t("conceptEdit")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="hint">{t("conceptEmpty")}</p>
          <button className="dashbtn" onClick={start}>
            {t("conceptWrite")}
          </button>
        </>
      )}
    </div>
  );
}
