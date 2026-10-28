/**
 * "Tu IA" (ESTUDIO_SKILLS.md, 6; H4): connecting it, how it gives its opinions, and its skills. Two places:
 * - "Skills activas" in the activity panel, as sketch 01 shows it: the skills that are on, with their
 *   origin, and "Gestionar skills…";
 * - Ajustes › Tu IA (ESTUDIO_INTERFAZ_2.md): every skill Four Hands serves, built in or the user's,
 *   turned on and off; import a ZIP or open the folder. A dot in the AI's colour marks the skills an
 *   AI loaded since the app opened.
 */
import { useEffect, useState } from "react";
import type { Strings } from "../../shared/i18n.js";
import type { AiApply, AiTone, SkillCardInfo } from "../../shared/protocol.js";
import { useActions, useAi, useApp } from "../context.js";

/** The built-in skills have a title and a description in the user's language. */
function builtInText(name: string): { title: keyof Strings; description: keyof Strings } | null {
  const key = `skill_${name.replace(/-/g, "_")}`;
  return ["skill_four_hands_basics", "skill_feelings_to_music", "skill_listening_review", "skill_orchestration_register", "skill_styles", "skill_jury"].includes(key)
    ? { title: key as keyof Strings, description: `${key}_d` as keyof Strings }
    : null;
}

export function AiSettings() {
  const { t, bridge } = useApp();
  const actions = useActions();
  const ai = useAi();
  const [skills, setSkills] = useState<SkillCardInfo[] | null>(null);
  const [tone, setTone] = useState<AiTone | null>(null);
  const [apply, setApply] = useState<AiApply | null>(null);

  useEffect(() => {
    void bridge.skills().then(setSkills);
  }, [actions.skillsVersion]);
  useEffect(() => {
    void bridge.aiTone().then(setTone);
    void bridge.aiApply().then(setApply);
  }, []);
  const pickTone = (next: AiTone) => void bridge.setAiTone(next).then(setTone);
  const pickApply = (next: AiApply) => void bridge.setAiApply(next).then(setApply);

  const used = new Set(ai.skillsUsed ?? []);
  const names = ai.clients.map((c) => c.name).join(", ");
  return (
    <div className="skillspanel">
      <div className="setconnect">
        <p className="setstatus" role="status">
          <span className={ai.clients.length ? "dot ai" : "dot off"} />
          {ai.clients.length ? t("aiConnected", { name: names }) : t("aiOff")}
        </p>
        <p className="skdesc">{t("setConnectHint")}</p>
        <button className="btn" onClick={() => bridge.connectClaude()}>
          {t("menuConnectClaude")}
        </button>
      </div>
      <div className="tonebox">
        <div className="toneh">
          <span className="sech">{t("toneTitle")}</span>
          <div className="seg" role="radiogroup" aria-label={t("toneTitle")}>
            {(["direct", "gentle"] as const).map((v) => (
              <button key={v} role="radio" aria-checked={tone === v} className={tone === v ? "segb on" : "segb"} onClick={() => pickTone(v)} data-tone={v}>
                {v === "direct" ? t("toneDirect") : t("toneGentle")}
              </button>
            ))}
          </div>
        </div>
        <p className="skdesc">{tone === "gentle" ? t("toneGentleHint") : t("toneDirectHint")}</p>
        <p className="skdesc toneall">{t("toneAlways")}</p>
      </div>
      <div className="tonebox">
        <div className="toneh">
          <span className="sech">{t("applyTitle")}</span>
          <div className="seg" role="radiogroup" aria-label={t("applyTitle")}>
            {(["direct", "proposal"] as const).map((v) => (
              <button key={v} role="radio" aria-checked={apply === v} className={apply === v ? "segb on" : "segb"} onClick={() => pickApply(v)} data-apply={v}>
                {v === "direct" ? t("applyDirect") : t("applyProposal")}
              </button>
            ))}
          </div>
        </div>
        <p className="skdesc">{apply === "proposal" ? t("applyProposalHint") : t("applyDirectHint")}</p>
      </div>
      <span className="sech skh">{t("skillsSection")}</span>
      <p className="skintro">{t("skillsIntro")}</p>
      <ul className="sklist">
        {skills?.length === 0 && <li className="hint">{t("skillsNone")}</li>}
        {skills?.map((s) => {
          const own = s.origin === "built-in" ? builtInText(s.name) : null;
          const title = own ? t(own.title) : s.name;
          const description = own ? t(own.description) : s.description;
          return (
            <li key={`${s.origin}:${s.name}`} className={s.enabled ? "skill" : "skill off"} data-skill={s.name}>
              <label className="skrow">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  aria-label={`${t("skillsOn")}: ${title}`}
                  onChange={(e) =>
                    void bridge.setSkillEnabled(s.name, e.target.checked).then((list) => {
                      setSkills(list);
                      actions.skillsChanged();
                    })
                  }
                />
                <span className="skname" title={s.name}>
                  {title}
                </span>
                <span className={s.origin === "user" ? "sktag u" : "sktag"}>{s.origin === "user" ? t("skillsYours") : t("skillsBuiltIn")}</span>
                {used.has(s.name) && (
                  <span className="skused" title={t("skillsUsed")}>
                    <span className="dot ai" />
                    {t("skillsUsed")}
                  </span>
                )}
              </label>
              <p className="skdesc">
                {description}
                {s.replacesBuiltIn && <span className="skrepl"> {t("skillsReplaces")}</span>}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="hint skhint">{t("skillsHint")}</p>
      <div className="qbtns">
        <button className="btn" onClick={() => bridge.openSkillsFolder()}>
          {t("skillsFolder")}
        </button>
        <button className="btn" onClick={() => void actions.importSkills(() => bridge.pickSkills())}>
          {t("skillsImport")}
        </button>
      </div>
    </div>
  );
}

/** "Skills activas" in the activity panel (sketch 01): name and origin, a dot if an AI used it. */
export function ActiveSkills() {
  const { t, bridge } = useApp();
  const actions = useActions();
  const ai = useAi();
  const [skills, setSkills] = useState<SkillCardInfo[] | null>(null);
  useEffect(() => {
    void bridge.skills().then(setSkills);
  }, [actions.skillsVersion]);
  const on = skills?.filter((s) => s.enabled) ?? [];
  const used = new Set(ai.skillsUsed ?? []);
  return (
    <div className="actskills">
      <p className="ah">{t("skills")}</p>
      {skills && !on.length && <p className="hint">{t("noSkills")}</p>}
      {on.map((s) => {
        const own = s.origin === "built-in" ? builtInText(s.name) : null;
        return (
          <div key={s.name} className="askill" title={own ? t(own.description) : s.description}>
            <span className="askname">
              {used.has(s.name) && <span className="dot ai" title={t("skillsUsed")} />}
              {own ? t(own.title) : s.name}
            </span>
            <span className="src">{s.origin === "user" ? t("skillsYours") : t("skillsBuiltIn")}</span>
          </div>
        );
      })}
      <button className="linkbtn askmanage" onClick={() => actions.openSkills(true)}>
        {t("skillsManage")}
      </button>
    </div>
  );
}
