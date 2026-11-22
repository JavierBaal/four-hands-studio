/** Line icons from the sketches: 16 × 16, 1.4–1.5 px stroke, round caps (docs/design.md, 8). */
import { T } from "../theme.js";
import { ERASER_PATH, PENCIL_PATH } from "../cursors.js";

const svg = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true } as const;

export const PlayIcon = () => (
  <svg {...svg}>
    <path d="M4 2.5v11l9-5.5z" fill="none" stroke={T.text} strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);
export const StopIcon = () => (
  <svg {...svg}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="none" stroke={T.text} strokeWidth="1.5" />
  </svg>
);
export const LoopIcon = () => (
  <svg {...svg}>
    <path d="M3 8a4 4 0 0 1 4-4h5M13 8a4 4 0 0 1-4 4H4M10 2l2 2-2 2M6 10l-2 2 2 2" fill="none" stroke={T.loop} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const RecordIcon = () => (
  <svg {...svg}>
    <circle cx="8" cy="8" r="4.5" />
  </svg>
);
export const ChevronRight = () => (
  <svg {...svg}>
    <path d="M6 3l5 5-5 5" fill="none" stroke={T.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ChevronLeft = () => (
  <svg {...svg}>
    <path d="M10 3L5 8l5 5" fill="none" stroke={T.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const EyeIcon = () => (
  <svg {...svg}>
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke={T.aiText} strokeWidth="1.4" />
    <circle cx="8" cy="8" r="2" fill="none" stroke={T.aiText} strokeWidth="1.4" />
  </svg>
);
export const ProposalIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="4" width="11" height="8" rx="1.5" fill="none" stroke={T.proposalLine} strokeWidth="1.4" strokeDasharray="2.5 2" />
  </svg>
);
export const HistoryIcon = () => (
  <svg {...svg}>
    <circle cx="8" cy="8" r="5.5" fill="none" stroke={T.text} strokeWidth="1.4" />
    <path d="M8 5v3l2 1.5" fill="none" stroke={T.text} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
export const KeyboardIcon = () => (
  <svg {...svg}>
    <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke={T.text} strokeWidth="1.4" />
    <path d="M4.5 3.5v5M8 3.5v5M11.5 3.5v5M3.5 10.5h9" fill="none" stroke={T.text} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
/** Tools of the piano roll bar (14/10/2026: icons instead of words). */
export const ArrowToolIcon = () => (
  <svg {...svg}>
    <path d="M4 2.5v10.5l2.8-2.6 1.9 4.1 1.7-.8-1.9-4.1 3.8-.2z" fill="none" stroke={T.text} strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
export const PencilIcon = () => (
  <svg {...svg}>
    <path d={PENCIL_PATH} fill="none" stroke={T.text} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const EraserIcon = () => (
  <svg {...svg}>
    <path d={ERASER_PATH} fill="none" stroke={T.text} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
/** Zoom tool: a magnifying glass (line icon, same stroke as the others). */
export const ZoomIcon = () => (
  <svg {...svg}>
    <circle cx="6.8" cy="6.8" r="4.3" fill="none" stroke={T.text} strokeWidth="1.4" />
    <path d="M10 10l3.8 3.8M5 6.8h3.6M6.8 5v3.6" fill="none" stroke={T.text} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
/** Back to the start: a bar and a triangle pointing left. */
export const ToStartIcon = () => (
  <svg {...svg}>
    <path d="M3.5 3v10M13 3L6 8l7 5z" fill="none" stroke={T.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Ajustes and its sections. Drawn in the current colour, so the button decides it.
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const GearIcon = () => (
  <svg {...svg}>
    <circle cx="8" cy="8" r="2.1" {...line} />
    <path
      d="M12.9 9.9a1.1 1.1 0 0 0 .2 1.2l.04.04a1.33 1.33 0 1 1-1.9 1.9l-.04-.04a1.1 1.1 0 0 0-1.2-.2 1.1 1.1 0 0 0-.67 1V14a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.2.2l-.04.04a1.33 1.33 0 1 1-1.9-1.9l.04-.04a1.1 1.1 0 0 0 .2-1.2 1.1 1.1 0 0 0-1-.67H2a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.2-1.2l-.04-.04a1.33 1.33 0 1 1 1.9-1.9l.04.04a1.1 1.1 0 0 0 1.2.2H6a1.1 1.1 0 0 0 .67-1V2a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.2-.2l.04-.04a1.33 1.33 0 1 1 1.9 1.9l-.04.04a1.1 1.1 0 0 0-.2 1.2V6a1.1 1.1 0 0 0 1 .67H14a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67z"
      {...line}
      strokeWidth={1.2}
    />
  </svg>
);
export const AiIcon = () => (
  <svg {...svg}>
    <circle cx="8" cy="8" r="5.5" {...line} />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>
);
export const KeysIcon = () => (
  <svg {...svg}>
    <rect x="2" y="3.5" width="12" height="9" rx="1" {...line} />
    <path d="M5.5 3.5v5.5M8 3.5v9M10.5 3.5v5.5" {...line} />
  </svg>
);
export const PlugIcon = () => (
  <svg {...svg}>
    <path d="M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 0 1-7 0zM8 11.5V14" {...line} />
  </svg>
);
export const MidiIcon = () => (
  <svg {...svg}>
    <circle cx="8" cy="8" r="5.5" {...line} />
    <circle cx="5.5" cy="8" r=".8" fill="currentColor" />
    <circle cx="10.5" cy="8" r=".8" fill="currentColor" />
    <circle cx="8" cy="5.5" r=".8" fill="currentColor" />
    <circle cx="6.2" cy="6.2" r=".6" fill="currentColor" />
    <circle cx="9.8" cy="6.2" r=".6" fill="currentColor" />
  </svg>
);
export const FolderIcon = () => (
  <svg {...svg}>
    <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" {...line} />
  </svg>
);
export const ToolsIcon = () => (
  <svg {...svg}>
    <path d="M3 13l5.5-5.5M9.5 3.2a3 3 0 0 0 3.3 3.3L11 8.3 7.7 5z" {...line} />
    <path d="M10 10.5l2.5 2.5" {...line} />
  </svg>
);
export const CloseIcon = () => (
  <svg {...svg}>
    <path d="M4 4l8 8M12 4l-8 8" {...line} />
  </svg>
);
export const TrackIcon = () => (
  <svg {...svg}>
    <path d="M3 4h10M3 8h10M3 12h10" {...line} />
    <circle cx="6" cy="4" r="1.4" {...line} fill="var(--bg-panel)" />
    <circle cx="10.5" cy="8" r="1.4" {...line} fill="var(--bg-panel)" />
    <circle cx="5" cy="12" r="1.4" {...line} fill="var(--bg-panel)" />
  </svg>
);
export const BankIcon = () => (
  <svg {...svg}>
    <ellipse cx="8" cy="4.5" rx="5" ry="2" {...line} />
    <path d="M3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" {...line} />
  </svg>
);
/** A plugin instrument's own window: a little synth, knobs over keys (track headers). */
export const PluginWindowIcon = () => (
  <svg {...svg}>
    <rect x="1.5" y="3" width="13" height="10" rx="1.5" {...line} />
    <path d="M1.5 7.5h13M5.5 7.5V13M8 7.5V13M10.5 7.5V13" {...line} />
    <circle cx="4.5" cy="5.25" r=".9" fill="currentColor" />
    <circle cx="7.5" cy="5.25" r=".9" fill="currentColor" />
  </svg>
);
export const WindowIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" {...line} />
    <path d="M2.5 6h11" {...line} />
  </svg>
);
export const SearchIcon = () => (
  <svg {...svg}>
    <circle cx="7" cy="7" r="4" {...line} />
    <path d="M10 10l3.5 3.5" {...line} />
  </svg>
);
export const StarIcon = ({ on = false }: { on?: boolean }) => (
  <svg {...svg}>
    <path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" {...line} fill={on ? "currentColor" : "none"} strokeWidth={1.3} />
  </svg>
);
export const LibraryIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="3" width="3" height="10" rx=".6" {...line} />
    <rect x="6.5" y="3" width="3" height="10" rx=".6" {...line} />
    <path d="M11 3.6l2.6.7-2.4 9-2.4-.6" {...line} />
  </svg>
);

/** The console (F2.2 part B): three faders. */
export const MixIcon = () => (
  <svg {...svg}>
    <path d="M4 2.5v11M8 2.5v11M12 2.5v11" fill="none" stroke={T.text} strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
    <rect x="2.5" y="8.5" width="3" height="2.5" rx=".8" fill={T.text} />
    <rect x="6.5" y="4.5" width="3" height="2.5" rx=".8" fill={T.text} />
    <rect x="10.5" y="10" width="3" height="2.5" rx=".8" fill={T.text} />
  </svg>
);
/** The editor (F2.2 part B): notes on a piano roll. */
export const EditorIcon = () => (
  <svg {...svg}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke={T.text} strokeWidth="1.4" opacity=".55" />
    <path d="M4.5 6h3M8.5 8.5h3M5.5 11h4" fill="none" stroke={T.text} strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
