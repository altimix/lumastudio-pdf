import { useLayoutEffect, useRef, useState } from "react";
import "./NumericField.css";

export interface NumericFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** A scrub preview is temporary; keep passing the committed value above. */
  onPreview?: (value: number | null) => void;
  onScrubStart?: () => void;
  onEditingChange?: (editing: boolean) => void;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  "aria-label": string;
  id?: string;
  disabled?: boolean;
  suffix?: string;
  className?: string;
}

interface Scrub {
  pointerId: number;
  startX: number;
  startValue: number;
  previewValue: number;
  active: boolean;
}

function parseDraft(draft: string): number | null {
  const text = draft.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function normalize(value: number, props: NumericFieldProps): number {
  const precision = Math.max(0, Math.min(6, props.precision ?? 2));
  const clamped = Math.max(props.min, Math.min(props.max, value));
  // Clamp once more because rounding must not push a page-bound dimension out.
  return Math.max(
    props.min,
    Math.min(props.max, Number(clamped.toFixed(precision))),
  );
}

function display(value: number, props: NumericFieldProps): string {
  return String(normalize(value, props));
}

/** Text editing stays local until blur/Enter; a horizontal scrub is one edit. */
export function NumericField(props: NumericFieldProps) {
  const latest = useRef(props);
  latest.current = props;
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLSpanElement>(null);
  const scrub = useRef<Scrub | null>(null);
  const dirty = useRef(false);
  const editing = useRef(false);
  const draftRef = useRef(display(props.value, props));
  const [draft, setDraft] = useState(draftRef.current);
  const [scrubbing, setScrubbing] = useState(false);
  const suppressClick = useRef(false);

  function show(value: string) {
    draftRef.current = value;
    setDraft(value);
  }

  function markEditing(active: boolean) {
    if (editing.current === active) return;
    editing.current = active;
    latest.current.onEditingChange?.(active);
  }

  function releasePointer(pointerId: number) {
    if (container.current?.hasPointerCapture(pointerId)) {
      container.current.releasePointerCapture(pointerId);
    }
  }

  function endScrub(commit: boolean) {
    const current = scrub.current;
    if (!current) return;
    scrub.current = null;
    if (current.active) {
      const currentProps = latest.current;
      dirty.current = false;
      markEditing(false);
      setScrubbing(false);
      if (commit && current.previewValue !== currentProps.value) {
        show(display(current.previewValue, currentProps));
        currentProps.onChange(current.previewValue);
      } else {
        show(display(currentProps.value, currentProps));
      }
      currentProps.onPreview?.(null);
    }
    releasePointer(current.pointerId);
  }

  function cancelDraft() {
    endScrub(false);
    dirty.current = false;
    markEditing(false);
    show(display(latest.current.value, latest.current));
  }

  function commitDraft() {
    if (latest.current.disabled || scrub.current?.active || !dirty.current)
      return;
    const currentProps = latest.current;
    const parsed = parseDraft(draftRef.current);
    const next =
      parsed === null ? currentProps.value : normalize(parsed, currentProps);
    dirty.current = false;
    markEditing(false);
    show(display(next, currentProps));
    if (next !== currentProps.value) currentProps.onChange(next);
  }

  // External edits, undo, and a changed range invalidate an unfinished draft.
  useLayoutEffect(() => {
    cancelDraft();
  }, [props.value, props.min, props.max, props.precision]);

  useLayoutEffect(() => {
    if (props.disabled) endScrub(false);
  }, [props.disabled]);

  useLayoutEffect(() => {
    function move(event: PointerEvent) {
      const current = scrub.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const delta = event.clientX - current.startX;
      if (!current.active && Math.abs(delta) < 6) return;
      if (!current.active) {
        current.active = true;
        dirty.current = false;
        markEditing(true);
        suppressClick.current = true;
        setScrubbing(true);
        container.current?.setPointerCapture(event.pointerId);
        latest.current.onScrubStart?.();
        // onScrubStart can synchronously select a different item or disable us.
        if (scrub.current !== current) return;
      }
      event.preventDefault();
      const currentProps = latest.current;
      const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const increment = (currentProps.step ?? 1) * multiplier;
      const next = normalize(
        current.startValue + Math.trunc(delta / 4) * increment,
        currentProps,
      );
      if (next !== current.previewValue) {
        current.previewValue = next;
        show(display(next, currentProps));
        currentProps.onPreview?.(next);
      }
    }
    function up(event: PointerEvent) {
      if (event.pointerId === scrub.current?.pointerId) endScrub(true);
    }
    function cancel(event: PointerEvent) {
      if (event.pointerId === scrub.current?.pointerId) endScrub(false);
    }
    function blur() {
      endScrub(false);
    }
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape" || !scrub.current?.active || event.isComposing)
        return;
      event.preventDefault();
      event.stopPropagation();
      endScrub(false);
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
      const current = scrub.current;
      scrub.current = null;
      markEditing(false);
      if (current?.active) latest.current.onPreview?.(null);
      if (current) releasePointer(current.pointerId);
    };
  }, []);

  const parsedDraft = parseDraft(draft);
  return (
    <span
      ref={container}
      className={`numeric-field ${scrubbing ? "is-scrubbing" : ""} ${props.className ?? ""}`}
      data-disabled={props.disabled || undefined}
      title="数値を入力、または左右にドラッグして変更。Shift で大きく、Alt で細かく調整"
      onPointerDown={(event) => {
        if (
          props.disabled ||
          event.button !== 0 ||
          event.pointerType === "touch"
        )
          return;
        if (scrub.current) endScrub(false);
        suppressClick.current = false;
        scrub.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startValue: props.value,
          previewValue: props.value,
          active: false,
        };
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === scrub.current?.pointerId) endScrub(false);
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <input
        ref={input}
        id={props.id}
        type="text"
        data-numeric-input="true"
        inputMode="decimal"
        role="spinbutton"
        aria-label={props["aria-label"]}
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        aria-valuenow={
          parsedDraft === null ? props.value : normalize(parsedDraft, props)
        }
        disabled={props.disabled}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          dirty.current = true;
          show(event.target.value);
          markEditing(
            event.target.value !==
              display(latest.current.value, latest.current),
          );
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (
            (event.ctrlKey || event.metaKey) &&
            ["s", "p"].includes(event.key.toLowerCase())
          ) {
            // App shortcuts read the committed edit synchronously after bubbling.
            commitDraft();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelDraft();
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commitDraft();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            const increment =
              (props.step ?? 1) *
              (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
            const next = normalize(
              (parseDraft(draftRef.current) ?? props.value) +
                (event.key === "ArrowUp" ? increment : -increment),
              props,
            );
            dirty.current = false;
            markEditing(false);
            show(display(next, props));
            if (next !== props.value) props.onChange(next);
          }
        }}
      />
      <span className="numeric-field-hint" aria-hidden="true">
        {props.suffix && <span>{props.suffix}</span>}
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path
            d="M1.5 8h13M4.5 5l-3 3 3 3M11.5 5l3 3-3 3"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}
