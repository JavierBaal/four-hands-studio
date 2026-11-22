/**
 * Sonidos:
 * every sound a track can have in one browser, after Studio One's. Search (accents and case do not
 * matter), filters by origin, favourites and recents, grouped by category or by vendor. Double
 * click or Enter puts the sound on the active track; dragging it onto a track header puts it on
 * that track, and onto the empty space under the tracks makes a new track with it.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Track } from "@fourhands/core";
import type { Strings } from "../../shared/i18n.js";
import { CATEGORIES, CATEGORY_NAMES, type EffectItem, type SoundCategory, type SoundFilter, type SoundItem, type SoundOrigin, bankKey, builtinKey, filterCatalog, filterEffects, groupCatalog, groupEffects, pluginKey } from "../../shared/sound-catalog.js";
import type { AudioLayer } from "../audio-layer.js";
import { activeTrack, useActions, useApp, useSong } from "../context.js";
import { trackColor } from "../theme.js";
import type { MenuItem } from "../editor.js";
import { BankIcon, KeysIcon, PlugIcon, SearchIcon, StarIcon } from "./Icons.js";
import { CategoryIcon } from "./CategoryIcon.js";

/** The drag payload: the sound's catalog key. */
export const SOUND_DRAG = "application/x-fourhands-sound";
/** An effect of the catalog being dragged onto a console slot (F2.2 part C): its key. */
export const EFFECT_DRAG = "application/x-fourhands-new-effect";

/** The catalog key of what a track plays now (to mark it in the list). */
export function currentSoundKey(track: Track): string | null {
  if (track.output === "plugin" && track.plugin) return pluginKey(track.plugin.id);
  if (track.sound) return bankKey(track.sound.bank, track.sound);
  if (track.channel === 9) return "fh:drums";
  return track.program === null ? null : builtinKey({ program: track.program, es: "", en: "" });
}

const FILTERS: { id: SoundFilter; label: keyof Strings }[] = [
  { id: "all", label: "sndAll" },
  { id: "fourHands", label: "sndFourHands" },
  { id: "plugins", label: "sndPlugins" },
  { id: "favorites", label: "sndFavorites" },
  { id: "recents", label: "sndRecents" },
];

const OriginIcon = ({ origin }: { origin: SoundOrigin }) => (origin === "plugin" ? <PlugIcon /> : origin === "bank" ? <BankIcon /> : <KeysIcon />);

function InstrumentsBrowser({ audio }: { audio: AudioLayer }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SoundFilter>("all");
  const [by, setBy] = useState<"category" | "vendor">("category");
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const track = activeTrack(song);

  useEffect(() => {
    if (!audio.pluginList && !audio.pluginScan && audio.engineStatus.state !== "missing") void audio.loadPlugins(false);
    search.current?.focus();
  }, []);

  const all = useMemo(() => audio.soundCatalog(lang, t("sndBuiltIn")), [audio.getVersion(), lang]);
  const items = filterCatalog(all, filter, query, audio.soundPrefs);
  const groups = filter === "recents" ? [{ id: "recents", label: t("sndRecents"), category: null, items }] : groupCatalog(items, by, lang, t("sndNoVendor"));
  const current = track ? currentSoundKey(track) : null;
  const currentGroup = groups.find((g) => g.items.some((i) => i.key === current))?.id;
  // Searching opens everything; otherwise only the group of the current sound, unless toggled.
  const isOpen = (id: string) => (query.trim() || filter !== "all" || groups.length <= 2 ? !toggled.has(id) : (id === currentGroup) !== toggled.has(id));
  const fav = new Set(audio.soundPrefs.favorites);
  const apply = (item: SoundItem) => track && actions.applySound(track.id, item);
  const toggleFav = (item: SoundItem) =>
    audio.updateSoundPrefs((p) => ({ ...p, favorites: fav.has(item.key) ? p.favorites.filter((k) => k !== item.key) : [...p.favorites, item.key] }));

  const rowMenu = (item: SoundItem, x: number, y: number) => {
    const close = (fn: () => void) => () => (actions.closeMenus(), fn());
    const move: MenuItem[] = CATEGORIES.map((c) => ({
      label: CATEGORY_NAMES[c][lang === "es" ? 0 : 1],
      active: item.category === c,
      run: close(() => audio.updateSoundPrefs((p) => ({ ...p, categories: { ...p.categories, [item.key]: c as SoundCategory } }))),
    }));
    actions.menu(x, y, [
      { label: item.name, header: true },
      ...(track ? [{ label: t("sndUseOn", { track: track.name }), run: close(() => apply(item)) }] : []),
      { label: fav.has(item.key) ? t("sndUnfavorite") : t("sndFavorite"), run: close(() => toggleFav(item)) },
      { separator: true },
      { label: t("sndMoveTo"), header: true },
      ...move,
      ...(item.origin === "plugin" ? [{ separator: true }, { label: t("sndHide"), run: close(() => audio.updateSoundPrefs((p) => ({ ...p, hidden: [...p.hidden, item.key] }))) }] : []),
    ]);
  };

  const highlight = (name: string) => {
    const q = query.trim();
    if (!q) return name;
    const at = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().indexOf(q.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
    if (at < 0) return name;
    return (
      <>
        {name.slice(0, at)}
        <mark>{name.slice(at, at + q.length)}</mark>
        {name.slice(at + q.length)}
      </>
    );
  };

  const engine = audio.engineStatus.state;
  const plugins = audio.pluginList?.plugins.filter((p) => p.instrument).length ?? 0;
  return (
    <div className="snd">
      <label className="sndsearch">
        <SearchIcon />
        <input ref={search} type="search" value={query} placeholder={t("sndSearch")} aria-label={t("sndSearch")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))} />
      </label>
      <div className="sndfilters" role="radiogroup" aria-label={t("sndFilter")}>
        {FILTERS.map((f) => (
          <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? "sndchip on" : "sndchip"} onClick={() => setFilter(f.id)}>
            {f.id === "fourHands" && <KeysIcon />}
            {f.id === "plugins" && <PlugIcon />}
            {f.id === "favorites" && <StarIcon on />}
            {t(f.label)}
          </button>
        ))}
      </div>
      {track && (
        <div className="sndfor">
          {t("sndFor")} <span className="dot sq" style={{ background: trackColor(track.color) }} />
          <b>{track.name}</b>
        </div>
      )}
      {filter !== "recents" && (
        <div className="sndby">
          <span className="hint">{t("sndGroupBy")}</span>
          <span className="seg small" role="radiogroup" aria-label={t("sndGroupBy")}>
            <button role="radio" aria-checked={by === "category"} className={by === "category" ? "segb on" : "segb"} onClick={() => (setBy("category"), setToggled(new Set()))}>
              {t("sndByCategory")}
            </button>
            <button role="radio" aria-checked={by === "vendor"} className={by === "vendor" ? "segb on" : "segb"} onClick={() => (setBy("vendor"), setToggled(new Set()))}>
              {t("sndByVendor")}
            </button>
          </span>
        </div>
      )}
      <div className="sndlist" role="tree" aria-label={t("tabSounds")}>
        {groups.length === 0 && <p className="hint">{filter === "favorites" && !query ? t("sndNoFavorites") : t("sndNothing")}</p>}
        {groups.map((g) => {
          const open = isOpen(g.id);
          return (
            <div key={g.id} className="sndgroup" role="treeitem" aria-expanded={open}>
              <button className={open ? "sndgh" : "sndgh closed"} onClick={() => setToggled((s) => new Set(s.has(g.id) ? [...s].filter((x) => x !== g.id) : [...s, g.id]))}>
                <span className="chev">›</span>
                {g.category && <CategoryIcon category={g.category} />}
                <span className="sndgname">{g.label}</span>
                <span className="n">{g.items.length}</span>
              </button>
              {open &&
                g.items.map((item) => (
                  <div
                    key={item.key}
                    role="treeitem"
                    tabIndex={0}
                    aria-selected={item.key === current}
                    data-sound={item.key}
                    className={`sndit${item.key === current ? " cur" : ""}${item.key === selected ? " sel" : ""}`}
                    title={t("sndRowHint")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(SOUND_DRAG, item.key);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setSelected(item.key)}
                    onDoubleClick={() => apply(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") apply(item);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      rowMenu(item, e.clientX, e.clientY);
                    }}
                  >
                    <span className="src" title={t(item.origin === "plugin" ? "sndOriginPlugin" : item.origin === "bank" ? "sndOriginBank" : "sndOriginBuiltin")}>
                      <OriginIcon origin={item.origin} />
                    </span>
                    <span className="nm">{highlight(item.name)}</span>
                    <span className="vd">{item.source}</span>
                    <button
                      className={fav.has(item.key) ? "st on" : "st"}
                      aria-pressed={fav.has(item.key)}
                      aria-label={fav.has(item.key) ? t("sndUnfavorite") : t("sndFavorite")}
                      title={fav.has(item.key) ? t("sndUnfavorite") : t("sndFavorite")}
                      onClick={(e) => (e.stopPropagation(), toggleFav(item))}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <StarIcon on={fav.has(item.key)} />
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      {engine === "missing" ? (
        <p className="sndnote">{t("sndNoEngine")}</p>
      ) : audio.pluginScan ? (
        <p className="sndnote">{t("setPluginsScanning", { pct: Math.round(audio.pluginScan.progress * 100), file: audio.pluginScan.file.split(/[\\/]/).pop() ?? "" })}</p>
      ) : audio.pluginList && plugins === 0 ? (
        <p className="sndnote">
          {t("sndNoPlugins")}{" "}
          <button className="linkbtn" onClick={() => actions.openSettings("plugins")}>
            {t("sndFindPlugins")}
          </button>
        </p>
      ) : null}
      <p className="sndnote">{t(query.trim() ? "sndCountOf" : "sndCount", { n: items.length, all: all.length })} · {t("sndHowTo")}</p>
    </div>
  );
}

/**
 * Sonidos shows instruments or effects (04/11/2026): with many plugins the «+» menu was chaos,
 * so the effects live here too, folded by type or by vendor, with search, favourites and recents.
 */
export function SoundsBrowser({ audio }: { audio: AudioLayer }) {
  const { t } = useApp();
  const actions = useActions();
  useSyncExternalStore(actions.subscribe, actions.getVersion);
  const mode = actions.soundsMode;
  return (
    <div className="sndwrap">
      <span className="seg small sndmode" role="radiogroup" aria-label={t("sndModeLabel")}>
        <button role="radio" aria-checked={mode === "instruments"} className={mode === "instruments" ? "segb on" : "segb"} onClick={() => actions.setSoundsMode("instruments")}>
          {t("sndInstruments")}
        </button>
        <button role="radio" aria-checked={mode === "effects"} className={mode === "effects" ? "segb on" : "segb"} onClick={() => actions.setSoundsMode("effects")}>
          {t("sndEffects")}
        </button>
      </span>
      {mode === "effects" ? <EffectsBrowser audio={audio} /> : <InstrumentsBrowser audio={audio} />}
    </div>
  );
}

function EffectsBrowser({ audio }: { audio: AudioLayer }) {
  const { t, lang } = useApp();
  const actions = useActions();
  const song = useSong();
  useSyncExternalStore(audio.subscribe, audio.getVersion);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SoundFilter>("all");
  const [by, setBy] = useState<"category" | "vendor">("category");
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!audio.pluginList && !audio.pluginScan && audio.engineStatus.state !== "missing") void audio.loadPlugins(false);
    search.current?.focus();
  }, []);

  const all = useMemo(() => audio.effectCatalog(lang, t("sndBuiltIn")), [audio.getVersion(), lang]);
  const items = filterEffects(all, filter, query, audio.soundPrefs);
  const groups = filter === "recents" ? [{ id: "recents", label: t("sndRecents"), category: null, items }] : groupEffects(items, by, lang, t("sndNoVendor"));
  // Folded by default (that is the point with many plugins); searching or filtering opens them.
  const isOpen = (id: string) => (query.trim() || filter !== "all" || groups.length <= 1 ? !toggled.has(id) : toggled.has(id));
  const fav = new Set(audio.soundPrefs.favorites);
  const target = actions.effectTarget();
  const targetName = target === "master" ? t("fxForMaster") : target ? (song.tracks[target]?.name ?? "") : null;
  const add = (item: EffectItem, where = target) => where && actions.addEffectItem(item, where);
  const toggleFav = (item: EffectItem) =>
    audio.updateSoundPrefs((p) => ({ ...p, favorites: fav.has(item.key) ? p.favorites.filter((k) => k !== item.key) : [...p.favorites, item.key] }));
  const track = activeTrack(song);

  const rowMenu = (item: EffectItem, x: number, y: number) => {
    const close = (fn: () => void) => () => (actions.closeMenus(), fn());
    actions.menu(x, y, [
      { label: item.name, header: true },
      ...(track ? [{ label: t("fxAddTo", { where: track.name }), run: close(() => add(item, track.id)) }] : []),
      { label: t("fxAddTo", { where: t("fxForMaster") }), run: close(() => add(item, "master")) },
      { label: fav.has(item.key) ? t("sndUnfavorite") : t("sndFavorite"), run: close(() => toggleFav(item)) },
      ...(item.origin === "plugin" ? [{ separator: true }, { label: t("sndHide"), run: close(() => audio.updateSoundPrefs((p) => ({ ...p, hidden: [...p.hidden, item.key] }))) }] : []),
    ]);
  };

  const plugins = all.filter((i) => i.origin === "plugin").length;
  return (
    <div className="snd">
      <label className="sndsearch">
        <SearchIcon />
        <input ref={search} type="search" value={query} placeholder={t("fxSearch")} aria-label={t("fxSearch")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))} />
      </label>
      <div className="sndfilters" role="radiogroup" aria-label={t("sndFilter")}>
        {FILTERS.map((f) => (
          <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? "sndchip on" : "sndchip"} onClick={() => setFilter(f.id)}>
            {f.id === "fourHands" && <KeysIcon />}
            {f.id === "plugins" && <PlugIcon />}
            {f.id === "favorites" && <StarIcon on />}
            {t(f.label)}
          </button>
        ))}
      </div>
      <div className="sndfor">
        {targetName !== null ? (
          <>
            {t("fxForTrack")} {target !== "master" && track && <span className="dot sq" style={{ background: trackColor(track.color) }} />}
            <b>{targetName}</b>
            <button className="linkbtn" onClick={() => actions.setFxTarget(target === "master" ? null : "master")}>
              {target === "master" ? t("fxUseActive") : t("fxUseMaster")}
            </button>
          </>
        ) : (
          t("fxNoTarget")
        )}
      </div>
      {filter !== "recents" && (
        <div className="sndby">
          <span className="hint">{t("sndGroupBy")}</span>
          <span className="seg small" role="radiogroup" aria-label={t("sndGroupBy")}>
            <button role="radio" aria-checked={by === "category"} className={by === "category" ? "segb on" : "segb"} onClick={() => (setBy("category"), setToggled(new Set()))}>
              {t("sndByType")}
            </button>
            <button role="radio" aria-checked={by === "vendor"} className={by === "vendor" ? "segb on" : "segb"} onClick={() => (setBy("vendor"), setToggled(new Set()))}>
              {t("sndByVendor")}
            </button>
          </span>
        </div>
      )}
      <div className="sndlist" role="tree" aria-label={t("sndEffects")}>
        {groups.length === 0 && <p className="hint">{filter === "favorites" && !query ? t("sndNoFavorites") : t("sndNothing")}</p>}
        {groups.map((g) => {
          const open = isOpen(g.id);
          return (
            <div key={g.id} className="sndgroup" role="treeitem" aria-expanded={open}>
              <button className={open ? "sndgh" : "sndgh closed"} onClick={() => setToggled((s) => new Set(s.has(g.id) ? [...s].filter((x) => x !== g.id) : [...s, g.id]))}>
                <span className="chev">›</span>
                <span className="sndgname">{g.label}</span>
                <span className="n">{g.items.length}</span>
              </button>
              {open &&
                g.items.map((item) => (
                  <div
                    key={item.key}
                    role="treeitem"
                    tabIndex={0}
                    data-effect={item.key}
                    className={`sndit${item.key === selected ? " sel" : ""}`}
                    title={t("fxRowHint")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(EFFECT_DRAG, item.key);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setSelected(item.key)}
                    onDoubleClick={() => add(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") add(item);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      rowMenu(item, e.clientX, e.clientY);
                    }}
                  >
                    <span className="src" title={t(item.origin === "plugin" ? "sndOriginPlugin" : "sndOriginBuiltin")}>
                      {item.origin === "plugin" ? <PlugIcon /> : <KeysIcon />}
                    </span>
                    <span className="nm">{item.name}</span>
                    <span className="vd">{item.source}</span>
                    <button
                      className={fav.has(item.key) ? "st on" : "st"}
                      aria-pressed={fav.has(item.key)}
                      aria-label={fav.has(item.key) ? t("sndUnfavorite") : t("sndFavorite")}
                      title={fav.has(item.key) ? t("sndUnfavorite") : t("sndFavorite")}
                      onClick={(e) => (e.stopPropagation(), toggleFav(item))}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <StarIcon on={fav.has(item.key)} />
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      {audio.engineStatus.state === "missing" ? (
        <p className="sndnote">{t("sndNoEngine")}</p>
      ) : audio.pluginScan ? (
        <p className="sndnote">{t("setPluginsScanning", { pct: Math.round(audio.pluginScan.progress * 100), file: audio.pluginScan.file.split(/[\\/]/).pop() ?? "" })}</p>
      ) : audio.pluginList && plugins === 0 ? (
        <p className="sndnote">
          {t("fxNoPluginsYet")}{" "}
          <button className="linkbtn" onClick={() => actions.openSettings("plugins")}>
            {t("sndFindPlugins")}
          </button>
        </p>
      ) : null}
      <p className="sndnote">{t(query.trim() ? "fxCountOf" : "fxCountAll", { n: items.length, all: all.length })} · {t("fxHowTo")}</p>
    </div>
  );
}
