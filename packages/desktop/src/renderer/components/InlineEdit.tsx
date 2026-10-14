/** A field typed in place (track name, title, tempo, section, chord, annotation). Enter or leaving it saves; Esc cancels. */
import { useEffect, useRef } from "react";

export interface InlineEditProps {
  value: string;
  onCommit(text: string): void;
  onCancel(): void;
  /** Enter or Tab and go on (chords: next bar). */
  onNext?(text: string): void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  title?: string;
  inputMode?: "text" | "numeric";
  maxLength?: number;
}

export function InlineEdit({ value, onCommit, onCancel, onNext, className, style, placeholder, title, inputMode, maxLength }: InlineEditProps) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return (
    <input
      ref={ref}
      className={className ? `inline ${className}` : "inline"}
      style={style}
      defaultValue={value}
      placeholder={placeholder}
      title={title}
      aria-label={title ?? placeholder}
      inputMode={inputMode}
      maxLength={maxLength ?? 60}
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" || (e.key === "Tab" && onNext)) {
          e.preventDefault();
          const text = e.currentTarget.value;
          finish(() => (onNext ? onNext(text) : onCommit(text)));
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(onCancel);
        }
      }}
      onBlur={(e) => {
        const text = e.currentTarget.value;
        finish(() => onCommit(text));
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
