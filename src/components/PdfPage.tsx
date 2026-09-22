import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type PointerEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation, PageInfo } from "../lib/types";
import { annotationToDataUrl, renderPdfPage } from "../lib/pdf";
import {
  pointOnPage,
  resizeAnnotation,
  type ResizeCorner,
} from "../lib/annotation-geometry";
import "./PdfPage.css";

export function AnnotationVisual({ annotation }: { annotation: Annotation }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = true;
    annotationToDataUrl(annotation)
      .then((value) => {
        if (current) setUrl(value);
      })
      .catch(() => {
        if (current) setUrl("");
      });
    return () => {
      current = false;
    };
  }, [annotation]);
  return url ? <img src={url} draggable={false} alt="" /> : null;
}

export function Thumbnail({
  document,
  page,
}: {
  document: PDFDocumentProxy;
  page: PageInfo;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const scratch = window.document.createElement("canvas");
    renderPdfPage(document, page.sourceIndex, scratch, 110 / page.width)
      .then(() => {
        if (!cancelled) {
          canvas.width = scratch.width;
          canvas.height = scratch.height;
          canvas.getContext("2d")?.drawImage(scratch, 0, 0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [document, page.sourceIndex, page.width]);
  return (
    <canvas ref={ref} style={{ transform: `rotate(${page.rotation}deg)` }} />
  );
}

export type PdfPageHandle = {
  /** Return the pending edit without committing it, so save uses the same snapshot. */
  flushText(): Annotation | null;
};

type Props = {
  ref?: Ref<PdfPageHandle>;
  document: PDFDocumentProxy;
  page: PageInfo;
  annotations: Annotation[];
  scale: number;
  selectedId: string | null;
  placing: boolean;
  readOnly: boolean;
  panning: boolean;
  isGesturePointer(pointerId: number): boolean;
  textDraft: Annotation | null;
  onTextDraftConsumed(): void;
  onTextEditingChange(active: boolean): void;
  onCommitText(annotation: Annotation): void;
  onResize(id: string, patch: Partial<Annotation>): void;
  onPlace(x: number, y: number): void;
  onSelect(id: string | null): void;
  onMove(id: string, x: number, y: number): void;
  onError(message: string): void;
};

type InlineDraft = { annotation: Annotation; original: Annotation | null };
type Interaction = {
  annotation: Annotation;
  pointerId: number;
  startX: number;
  startY: number;
  corner?: ResizeCorner;
};
const CORNERS: Array<{ corner: ResizeCorner; label: string }> = [
  { corner: "nw", label: "左上" },
  { corner: "ne", label: "右上" },
  { corner: "sw", label: "左下" },
  { corner: "se", label: "右下" },
];
const TEXT_FONT =
  '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif';

function textWithHeight(
  annotation: Annotation,
  text: string,
  pageHeight: number,
): Annotation {
  const fontSize = annotation.fontSize || 16;
  const context = window.document.createElement("canvas").getContext("2d");
  let lines = 0;
  if (context) context.font = `400 ${fontSize}px ${TEXT_FONT}`;
  for (const paragraph of text.split("\n")) {
    let line = "";
    lines++;
    for (const character of Array.from(paragraph)) {
      if (
        line &&
        context &&
        context.measureText(line + character).width >
          Math.max(1, annotation.width - 4)
      ) {
        lines++;
        line = character;
      } else line += character;
    }
  }
  return {
    ...annotation,
    text,
    color: annotation.color || "#000000",
    height: Math.min(
      pageHeight - annotation.y,
      Math.max(annotation.height, lines * fontSize * 1.4 + 6),
    ),
  };
}

export function PdfPage({
  ref,
  document,
  page,
  annotations,
  scale,
  selectedId,
  placing,
  readOnly,
  panning,
  isGesturePointer,
  textDraft,
  onTextDraftConsumed,
  onTextEditingChange,
  onCommitText,
  onResize,
  onPlace,
  onSelect,
  onMove,
  onError,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [actionsSize, setActionsSize] = useState({ width: 380, height: 42 });
  const interaction = useRef<Interaction | null>(null);
  const previewRef = useRef<Annotation | null>(null);
  const [preview, setPreview] = useState<Annotation | null>(null);
  const [draft, setDraft] = useState<InlineDraft | null>(null);
  const draftRef = useRef<InlineDraft | null>(null);
  const consumedDraft = useRef<string | null>(null);
  const composing = useRef(false);
  const touchPlace = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const renderedPage = useRef<string | null>(null);
  const latestEditingChange = useRef(onTextEditingChange);
  latestEditingChange.current = onTextEditingChange;

  const changeDraft = (next: InlineDraft | null) => {
    const wasEditing = !!draftRef.current;
    draftRef.current = next;
    setDraft(next);
    if (wasEditing !== !!next) onTextEditingChange(!!next);
  };
  const clearInteraction = () => {
    interaction.current = null;
    previewRef.current = null;
    setPreview(null);
  };
  const takeDraft = (): Annotation | null => {
    const pending = draftRef.current;
    if (!pending) return null;
    changeDraft(null);
    composing.current = false;
    if (
      readOnly ||
      !pending.annotation.text?.trim() ||
      pending.annotation.pageId !== page.id
    )
      return null;
    if (pending.original && pending.original.text === pending.annotation.text)
      return null;
    return pending.annotation;
  };
  const commitDraft = () => {
    const annotation = takeDraft();
    if (annotation) onCommitText(annotation);
  };
  const cancelDraft = () => {
    composing.current = false;
    changeDraft(null);
  };
  useImperativeHandle(ref, () => ({ flushText: takeDraft }));

  useEffect(() => () => latestEditingChange.current(false), []);
  useEffect(() => {
    if (
      draftRef.current &&
      (readOnly || draftRef.current.annotation.pageId !== page.id)
    )
      cancelDraft();
    clearInteraction();
    touchPlace.current = null;
  }, [page.id, readOnly]);
  useEffect(() => {
    if (!textDraft || consumedDraft.current === textDraft.id) return;
    consumedDraft.current = textDraft.id;
    if (!readOnly && textDraft.pageId === page.id) {
      commitDraft();
      changeDraft({
        annotation: textWithHeight(
          textDraft,
          textDraft.text || "",
          page.height,
        ),
        original: null,
      });
      clearInteraction();
    }
    onTextDraftConsumed();
  }, [textDraft, readOnly, page.id]);
  useLayoutEffect(() => {
    if (!draft) return;
    const input = textareaRef.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [draft?.annotation.id]);
  useLayoutEffect(() => {
    const actions = actionsRef.current;
    if (!actions) return;
    const update = () =>
      setActionsSize({
        width: actions.offsetWidth,
        height: actions.offsetHeight,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(actions);
    return () => observer.disconnect();
  }, [draft?.annotation.id]);

  useEffect(() => {
    let cancelled = false;
    const pageKey = `${page.id}:${page.sourceIndex}`;
    // Keep the existing bitmap during a gesture, then render the final scale sharply.
    const timer = window.setTimeout(
      () => {
        const scratch =
          scratchRef.current ??
          (scratchRef.current = window.document.createElement("canvas"));
        renderPdfPage(document, page.sourceIndex, scratch, scale)
          .then(() => {
            if (!cancelled && canvasRef.current) {
              const canvas = canvasRef.current;
              canvas.width = scratch.width;
              canvas.height = scratch.height;
              canvas.getContext("2d")?.drawImage(scratch, 0, 0);
              renderedPage.current = pageKey;
            }
          })
          .catch((error) => {
            if (!cancelled) onError(String(error));
          });
      },
      renderedPage.current === pageKey ? 90 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [document, page.id, page.sourceIndex, scale, onError]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && interaction.current) {
        clearInteraction();
        event.preventDefault();
      }
    };
    const blur = () => {
      clearInteraction();
      touchPlace.current = null;
    };
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const sideways = page.rotation % 180 !== 0;
  const outerWidth = (sideways ? page.height : page.width) * scale;
  const outerHeight = (sideways ? page.width : page.height) * scale;
  const toPoint = (clientX: number, clientY: number) =>
    pointOnPage(
      { x: clientX, y: clientY },
      surfaceRef.current!.getBoundingClientRect(),
      scale,
      page,
    );
  const beginTextEdit = (annotation: Annotation) => {
    if (readOnly || panning || annotation.type !== "text") return;
    commitDraft();
    onSelect(annotation.id);
    clearInteraction();
    changeDraft({
      annotation: { ...annotation, color: annotation.color || "#000000" },
      original: annotation,
    });
  };
  const moveInteraction = (event: PointerEvent<HTMLElement>) => {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (readOnly || panning || isGesturePointer(event.pointerId)) {
      clearInteraction();
      return;
    }
    const point = toPoint(event.clientX, event.clientY);
    const { annotation } = current;
    const delta = { x: point.x - current.startX, y: point.y - current.startY };
    const patch = current.corner
      ? resizeAnnotation(annotation, current.corner, delta, page)
      : {
          x: Math.max(
            0,
            Math.min(page.width - annotation.width, annotation.x + delta.x),
          ),
          y: Math.max(
            0,
            Math.min(page.height - annotation.height, annotation.y + delta.y),
          ),
        };
    const next = { ...annotation, ...patch };
    previewRef.current = next;
    setPreview(next);
  };
  const finishInteraction = (event: PointerEvent<HTMLElement>) => {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = previewRef.current;
    if (!readOnly && !panning && !isGesturePointer(event.pointerId) && next) {
      if (current.corner) {
        if (
          next.width !== current.annotation.width ||
          next.height !== current.annotation.height
        ) {
          onResize(next.id, {
            x: next.x,
            y: next.y,
            width: next.width,
            height: next.height,
            ...(next.type === "text" ? { fontSize: next.fontSize } : {}),
          });
        }
      } else if (
        next.x !== current.annotation.x ||
        next.y !== current.annotation.y
      )
        onMove(next.id, next.x, next.y);
    }
    clearInteraction();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const actionPosition = () => {
    if (!draft) return { x: 0, y: 0 };
    const screenPoint = (x: number, y: number) => {
      if (page.rotation === 90) return { x: page.height - y, y: x };
      if (page.rotation === 180)
        return { x: page.width - x, y: page.height - y };
      if (page.rotation === 270) return { x: y, y: page.width - x };
      return { x, y };
    };
    const annotation = draft.annotation;
    const a = screenPoint(annotation.x, annotation.y);
    const b = screenPoint(
      annotation.x + annotation.width,
      annotation.y + annotation.height,
    );
    const left = Math.max(
      4,
      Math.min(Math.min(a.x, b.x) * scale, outerWidth - actionsSize.width - 4),
    );
    const below = Math.max(a.y, b.y) * scale + 8;
    const top =
      below + actionsSize.height < outerHeight - 4
        ? below
        : Math.max(4, Math.min(a.y, b.y) * scale - actionsSize.height - 8);
    const point = pointOnPage(
      { x: left, y: top },
      { left: 0, top: 0 },
      scale,
      page,
    );
    return {
      x: (point.x - annotation.x) * scale,
      y: (point.y - annotation.y) * scale,
    };
  };
  const actionsAt = actionPosition();

  return (
    <div
      className="page-outer"
      style={{ width: outerWidth, height: outerHeight }}
    >
      <div
        ref={surfaceRef}
        className={`pdf-surface ${placing && !readOnly && !panning ? "placing" : ""} ${readOnly ? "readonly" : ""} ${panning ? "panning" : ""}`}
        data-testid="pdf-surface"
        style={{
          width: page.width * scale,
          height: page.height * scale,
          transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
        }}
        onPointerDown={(event) => {
          if (
            event.target !== event.currentTarget &&
            event.target !== canvasRef.current
          )
            return;
          if (
            event.button !== 0 ||
            panning ||
            isGesturePointer(event.pointerId)
          )
            return;
          commitDraft();
          if (event.pointerType === "touch") {
            touchPlace.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
            return;
          }
          const point = toPoint(event.clientX, event.clientY);
          if (placing && !readOnly) onPlace(point.x, point.y);
          else onSelect(null);
        }}
        onPointerMove={(event) => {
          const pending = touchPlace.current;
          if (
            pending?.id === event.pointerId &&
            Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8
          )
            pending.moved = true;
        }}
        onPointerUp={(event) => {
          const pending = touchPlace.current;
          if (pending?.id !== event.pointerId) return;
          touchPlace.current = null;
          if (pending.moved || panning || isGesturePointer(event.pointerId))
            return;
          const point = toPoint(event.clientX, event.clientY);
          if (placing && !readOnly) onPlace(point.x, point.y);
          else onSelect(null);
        }}
        onPointerCancel={() => {
          touchPlace.current = null;
        }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        {annotations.map((annotation) => {
          const visual = preview?.id === annotation.id ? preview : annotation;
          const editing = draft?.annotation.id === annotation.id;
          return (
            <div
              key={annotation.id}
              role="button"
              tabIndex={0}
              aria-label={`${annotation.type === "stamp" ? "印鑑" : annotation.type === "text" ? "文字" : annotation.type === "check" ? "チェック" : "画像"}: ${annotation.text ?? ""}`}
              aria-pressed={selectedId === annotation.id}
              className={`annotation ${selectedId === annotation.id && !editing ? "selected" : ""} ${editing ? "editing" : ""}`}
              style={{
                left: visual.x * scale,
                top: visual.y * scale,
                width: visual.width * scale,
                height: visual.height * scale,
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Enter" && annotation.type === "text")
                    beginTextEdit(annotation);
                  else onSelect(annotation.id);
                }
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                beginTextEdit(annotation);
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (
                  event.button !== 0 ||
                  panning ||
                  isGesturePointer(event.pointerId)
                )
                  return;
                commitDraft();
                onSelect(annotation.id);
                if (readOnly) return;
                const point = toPoint(event.clientX, event.clientY);
                interaction.current = {
                  annotation,
                  pointerId: event.pointerId,
                  startX: point.x,
                  startY: point.y,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={moveInteraction}
              onPointerUp={finishInteraction}
              onPointerCancel={clearInteraction}
              onLostPointerCapture={clearInteraction}
            >
              <AnnotationVisual annotation={visual} />
              {selectedId === annotation.id &&
                !readOnly &&
                !editing &&
                !panning &&
                CORNERS.map(({ corner, label }) => (
                  <button
                    key={corner}
                    type="button"
                    className={`annotation-resize-handle ${corner}`}
                    data-testid={`resize-${corner}`}
                    aria-label={`${label}のサイズ変更`}
                    title={`${label}をドラッグしてサイズ変更`}
                    style={{
                      cursor:
                        (corner === "nw" || corner === "se") !== sideways
                          ? "nwse-resize"
                          : "nesw-resize",
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (
                        event.button !== 0 ||
                        isGesturePointer(event.pointerId)
                      )
                        return;
                      event.preventDefault();
                      const point = toPoint(event.clientX, event.clientY);
                      interaction.current = {
                        annotation,
                        pointerId: event.pointerId,
                        startX: point.x,
                        startY: point.y,
                        corner,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      event.stopPropagation();
                      moveInteraction(event);
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      finishInteraction(event);
                    }}
                    onPointerCancel={(event) => {
                      event.stopPropagation();
                      clearInteraction();
                    }}
                    onLostPointerCapture={(event) => {
                      event.stopPropagation();
                      clearInteraction();
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <span />
                  </button>
                ))}
            </div>
          );
        })}
        {draft && (
          <div
            className="inline-text-editor"
            data-testid="inline-text-editor"
            style={{
              left: draft.annotation.x * scale,
              top: draft.annotation.y * scale,
              width: draft.annotation.width * scale,
              height: draft.annotation.height * scale,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                commitDraft();
            }}
          >
            <textarea
              ref={textareaRef}
              aria-label="PDF上の文字入力"
              data-testid="inline-text-input"
              placeholder="ここに文字を入力"
              value={draft.annotation.text || ""}
              spellCheck={false}
              maxLength={3000}
              style={{
                fontFamily: TEXT_FONT,
                fontSize: (draft.annotation.fontSize || 16) * scale,
                lineHeight: 1.4,
                padding: `${2 * scale}px`,
                color: draft.annotation.color || "#000000",
              }}
              onChange={(event) => {
                if (!draftRef.current) return;
                changeDraft({
                  ...draftRef.current,
                  annotation: textWithHeight(
                    draftRef.current.annotation,
                    event.target.value,
                    page.height,
                  ),
                });
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelDraft();
                } else if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  commitDraft();
                }
              }}
            />
            <div
              ref={actionsRef}
              className="inline-text-actions"
              style={{
                left: actionsAt.x,
                top: actionsAt.y,
                maxWidth: Math.max(120, outerWidth - 8),
                transform: `rotate(${-page.rotation}deg)`,
                transformOrigin: "0 0",
              }}
            >
              <button
                type="button"
                aria-label="文字入力を確定"
                onPointerDown={(event) => event.preventDefault()}
                onClick={commitDraft}
              >
                完了
              </button>
              <button
                type="button"
                aria-label="文字入力をキャンセル"
                onPointerDown={(event) => event.preventDefault()}
                onClick={cancelDraft}
              >
                キャンセル
              </button>
              <span>改行 Enter · 確定 Ctrl / ⌘ + Enter</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
