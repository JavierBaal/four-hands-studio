/** Line icons from the sketches: 16 × 16, 1.4–1.5 px stroke, round caps (DIRECCION_ARTISTICA.md, 8). */
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
/** Tools of the piano roll bar (Fran, 14/10/2026: icons instead of words). */
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

// ESTUDIO_INTERFAZ_2.md: Ajustes and its sections. Drawn in the current colour, so the button decides it.
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
