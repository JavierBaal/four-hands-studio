/** Line icons from the sketches: 16 × 16, 1.4–1.5 px stroke, round caps (DIRECCION_ARTISTICA.md, 8). */
import { T } from "../theme.js";

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
