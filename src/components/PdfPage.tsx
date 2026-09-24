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
import type { Annotation, MarkerCap, PageInfo, ShapeKind } from "../lib/types";
import { annotationToDataUrl, renderPdfPage } from "../lib/pdf";
import {
  ensureTextFont,
  fontCssFamily,
  isTextFontReady,
  measureTextHeight,
} from "../lib/fonts";
import {
  pointOnPage,
  resizeAnnotation,
  isAspectLocked,
  type ResizeHandle,
} from "../lib/annotation-geometry";
import { inkStrokeIntersectsSegment, MAX_INK_POINTS, type InkKind, type InkPoint } from "../lib/ink";
import { shapeLineSegments, shapePlacementFromDrag, type ShapePlacement } from "../lib/shape-placement";
import "./PdfPage.css";

export function AnnotationVisual({
  annotation,
  onError,
}: {
  annotation: Annotation;
  onError?(message: string): void;
}) {
  const [url, setUrl] = useState("");
  const latestError = useRef(onError);
  latestError.current = onError;
  useEffect(() => {
    let current = true;
    annotationToDataUrl(annotation)
      .then((value) => {
        if (current) setUrl(value);
      })
      .catch((error) => {
        if (current) {
          setUrl("");
          latestError.current?.(
            error instanceof Error ? error.message : String(error),
          );
        }
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
  annotated = false,
}: {
  document: PDFDocumentProxy;
  page: PageInfo;
  annotated?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sideways = page.rotation % 180 !== 0;
  const displayWidth = sideways ? page.height : page.width;
  const displayHeight = sideways ? page.width : page.height;
  const paperWidth = Math.min(116, 150 * displayWidth / displayHeight);
  const renderScale = Math.min(116 / displayWidth, 150 / displayHeight);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const scratch = window.document.createElement("canvas");
    renderPdfPage(document, page.sourceIndex, scratch, renderScale)
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
  }, [document, page.sourceIndex, renderScale]);
  return (
    <div className="thumbnail-paper" style={{ width: paperWidth, aspectRatio: `${displayWidth} / ${displayHeight}` }}>
      <canvas
        ref={ref}
        style={{
          width: `${page.width / displayWidth * 100}%`,
          height: `${page.height / displayHeight * 100}%`,
          transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
        }}
      />
      {annotated && <span className="edited-dot" />}
    </div>
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
  inkTool: InkKind | 'eraser' | null;
  inkColor: string;
  inkWidth: number;
  markerCap: MarkerCap;
  shapeStyle: Pick<Annotation, 'shapeKind' | 'strokeColor' | 'fillColor' | 'strokeWidth'> & { shapeKind: ShapeKind } | null;
  readOnly: boolean;
  panning: boolean;
  isGesturePointer(pointerId: number): boolean;
  textDraft: Annotation | null;
  onTextDraftConsumed(): void;
  onTextEditingChange(active: boolean): void;
  onCommitText(annotation: Annotation): void;
  onResize(id: string, patch: Partial<Annotation>): void;
  onPlace(x: number, y: number, shapePlacement?: ShapePlacement): void;
  onDrawInk(kind: InkKind, points: InkPoint[]): void;
  onEraseInk(ids: string[]): void;
  onSelect(id: string | null): void;
  onMove(id: string, x: number, y: number): void;
  onError(message: string): void;
};

type InlineDraft = {
  annotation: Annotation;
  original: Annotation | null;
  fontReady: boolean;
  fontError?: boolean;
};
type Interaction = {
  annotation: Annotation;
  pointerId: number;
  startX: number;
  startY: number;
  corner?: ResizeHandle;
};
type InkGesture = {
  pointerId: number;
  kind: InkKind | 'eraser';
  points: InkPoint[];
  straight: boolean;
  lastPoint: InkPoint;
  eraseIds: Set<string>;
};
const CORNERS: Array<{ corner: ResizeHandle; label: string }> = [
  { corner: "nw", label: "左上" },
  { corner: "ne", label: "右上" },
  { corner: "sw", label: "左下" },
  { corner: "se", label: "右下" },
];
const EDGES: Array<{ corner: ResizeHandle; label: string }> = [
  { corner: "n", label: "上辺" },
  { corner: "e", label: "右辺" },
  { corner: "s", label: "下辺" },
  { corner: "w", label: "左辺" },
];

function resizeCursor(handle: ResizeHandle, sideways: boolean): string {
  if (handle === "n" || handle === "s")
    return sideways ? "ew-resize" : "ns-resize";
  if (handle === "e" || handle === "w")
    return sideways ? "ns-resize" : "ew-resize";
  return (handle === "nw" || handle === "se") !== sideways
    ? "nwse-resize"
    : "nesw-resize";
}

function textWithHeight(
  annotation: Annotation,
  text: string,
  pageHeight: number,
): Annotation {
  return {
    ...annotation,
    text,
    color: annotation.color || "#000000",
    height: Math.min(
      pageHeight - annotation.y,
      Math.max(annotation.height, measureTextHeight({ ...annotation, text })),
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
  inkTool,
  inkColor,
  inkWidth,
  markerCap,
  shapeStyle,
  readOnly,
  panning,
  isGesturePointer,
  textDraft,
  onTextDraftConsumed,
  onTextEditingChange,
  onCommitText,
  onResize,
  onPlace,
  onDrawInk,
  onEraseInk,
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
  const inkGesture = useRef<InkGesture | null>(null);
  const [inkPreview, setInkPreview] = useState<InkPoint[] | null>(null);
  const shapeGesture = useRef<{ pointerId: number; start: InkPoint; clientX: number; clientY: number } | null>(null);
  const [shapePreview, setShapePreview] = useState<ShapePlacement | null>(null);
  const [eraserPoint, setEraserPoint] = useState<InkPoint | null>(null);
  const [pendingEraseIds, setPendingEraseIds] = useState<Set<string>>(() => new Set());
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
  const clearInkGesture = () => {
    inkGesture.current = null;
    setInkPreview(null);
    setEraserPoint(null);
    setPendingEraseIds(new Set());
  };
  const clearShapeGesture = () => {
    shapeGesture.current = null;
    setShapePreview(null);
  };
  const takeDraft = (): Annotation | null => {
    const pending = draftRef.current;
    // Loading another document can fail. Keep the previous draft while editing
    // is temporarily disabled, so that failure cannot silently erase input.
    if (!pending || readOnly) return null;
    changeDraft(null);
    composing.current = false;
    if (
      (!pending.original && !pending.annotation.text?.trim()) ||
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
    if (draftRef.current && draftRef.current.annotation.pageId !== page.id)
      cancelDraft();
    clearInteraction();
    clearInkGesture();
    touchPlace.current = null;
  }, [page.id, readOnly, inkTool]);
  useEffect(() => {
    if (!textDraft || consumedDraft.current === textDraft.id) return;
    consumedDraft.current = textDraft.id;
    if (!readOnly && textDraft.pageId === page.id) {
      commitDraft();
      const fontReady = isTextFontReady(textDraft);
      changeDraft({
        annotation: fontReady
          ? textWithHeight(textDraft, textDraft.text || "", page.height)
          : textDraft,
        original: null,
        fontReady,
      });
      clearInteraction();
    }
    onTextDraftConsumed();
  }, [textDraft, readOnly, page.id]);
  useEffect(() => {
    const pending = draftRef.current;
    if (!pending || pending.fontReady) return;
    let cancelled = false;
    ensureTextFont(pending.annotation)
      .then(() => {
        if (cancelled || draftRef.current !== pending) return;
        changeDraft({
          ...pending,
          annotation: textWithHeight(
            pending.annotation,
            pending.annotation.text || "",
            page.height,
          ),
          fontReady: true,
        });
      })
      .catch((error) => {
        if (cancelled || draftRef.current !== pending) return;
        changeDraft({ ...pending, fontError: true });
        onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    draft?.annotation.id,
    draft?.annotation.fontFamily,
    draft?.annotation.fontWeight,
    draft?.annotation.fontStyle,
  ]);
  useEffect(() => {
    const current = draftRef.current;
    if (!current?.fontReady || !current.annotation.text || isTextFontReady(current.annotation)) return;
    let cancelled = false;
    const requested = current.annotation;
    // Keep the textarea active while an IME is composing. Once the user pauses,
    // load only the new glyphs and recalculate the height with the actual face.
    const timer = window.setTimeout(() => {
      void ensureTextFont(requested)
        .then(() => {
          const latest = draftRef.current;
          if (cancelled || !latest || latest.annotation.id !== requested.id || latest.annotation.text !== requested.text) return;
          changeDraft({ ...latest, annotation: textWithHeight(latest.annotation, requested.text || "", page.height) });
        })
        .catch((error: unknown) => { if (!cancelled) onError(String(error)); });
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft?.annotation.id, draft?.annotation.text, draft?.annotation.fontFamily, draft?.annotation.fontWeight, draft?.annotation.fontStyle, draft?.fontReady, page.height]);
  useLayoutEffect(() => {
    if (!draft?.fontReady || readOnly) return;
    if (
      window.document.querySelector(
        '[role="dialog"][aria-modal="true"], dialog[open]',
      )
    )
      return;
    const input = textareaRef.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [draft?.annotation.id, draft?.fontReady]);
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
      } else if (event.key === "Escape" && inkGesture.current) {
        clearInkGesture();
        event.preventDefault();
      } else if (event.key === "Escape" && shapeGesture.current) {
        clearShapeGesture();
        event.preventDefault();
      }
    };
    const blur = () => {
      clearInteraction();
      clearInkGesture();
      clearShapeGesture();
      touchPlace.current = null;
    };
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", cancel, true);
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
  const toInkPoint = (clientX: number, clientY: number): InkPoint => {
    const point = toPoint(clientX, clientY);
    return { x: Math.max(0, Math.min(page.width, point.x)), y: Math.max(0, Math.min(page.height, point.y)) };
  };
  const collectEraseHits = (point: InkPoint, gesture: InkGesture) => {
    for (const annotation of annotations) if (inkStrokeIntersectsSegment(annotation, gesture.lastPoint, point)) gesture.eraseIds.add(annotation.id);
    gesture.lastPoint = point;
    setPendingEraseIds(new Set(gesture.eraseIds));
  };
  const appendInkPoint = (gesture: InkGesture, point: InkPoint) => {
    const last = gesture.points.at(-1)!;
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.8) return;
    if (gesture.points.length >= MAX_INK_POINTS)
      gesture.points = gesture.points.filter((_, index) => index % 2 === 0 || index === gesture.points.length - 1);
    gesture.points.push(point);
  };
  const moveInk = (event: PointerEvent<HTMLDivElement>) => {
    const point = toInkPoint(event.clientX, event.clientY);
    if (inkTool === 'eraser') setEraserPoint(point);
    const gesture = inkGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (readOnly || panning || isGesturePointer(event.pointerId)) { clearInkGesture(); return; }
    if (gesture.kind === 'eraser') { collectEraseHits(point, gesture); return; }
    gesture.straight ||= event.shiftKey;
    if (gesture.straight) gesture.points = [gesture.points[0], point];
    else appendInkPoint(gesture, point);
    setInkPreview([...gesture.points]);
  };
  const finishInk = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = inkGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!readOnly && !panning && !isGesturePointer(event.pointerId)) {
      const point = toInkPoint(event.clientX, event.clientY);
      if (gesture.kind === 'eraser') {
        collectEraseHits(point, gesture);
        onEraseInk([...gesture.eraseIds]);
      } else {
        gesture.straight ||= event.shiftKey;
        if (gesture.straight) gesture.points = [gesture.points[0], point];
        else appendInkPoint(gesture, point);
        onDrawInk(gesture.kind, gesture.points);
      }
    }
    clearInkGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveShape = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = shapeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !shapeStyle) return;
    if (readOnly || panning || isGesturePointer(event.pointerId)) { clearShapeGesture(); return; }
    const distance = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
    setShapePreview(distance >= 5 ? shapePlacementFromDrag(gesture.start, toInkPoint(event.clientX, event.clientY), page, shapeStyle.shapeKind) : null);
  };
  const finishShape = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = shapeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const valid = !readOnly && !panning && !isGesturePointer(event.pointerId);
    const distance = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
    const placement = valid && shapeStyle && distance >= 5
      ? shapePlacementFromDrag(gesture.start, toInkPoint(event.clientX, event.clientY), page, shapeStyle.shapeKind) : undefined;
    clearShapeGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (valid) onPlace(gesture.start.x, gesture.start.y, placement);
  };
  const beginTextEdit = (annotation: Annotation) => {
    if (readOnly || panning || annotation.type !== "text") return;
    commitDraft();
    onSelect(annotation.id);
    clearInteraction();
    changeDraft({
      annotation: { ...annotation, color: annotation.color || "#000000" },
      original: annotation,
      fontReady: isTextFontReady(annotation),
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
              aria-label={`${annotation.type === "stamp" ? "印鑑" : annotation.type === "text" ? "文字" : annotation.type === "check" ? "チェック" : annotation.type === "shape" ? "図形" : annotation.type === "pen" ? "ペン" : annotation.type === "marker" ? "蛍光ペン" : "画像"}: ${annotation.text ?? ""}`}
              aria-pressed={selectedId === annotation.id}
              className={`annotation ${selectedId === annotation.id && !editing ? "selected" : ""} ${editing ? "editing" : ""} ${pendingEraseIds.has(annotation.id) ? "pending-erase" : ""}`}
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
              <AnnotationVisual annotation={visual} onError={onError} />
              {selectedId === annotation.id &&
                !readOnly &&
                !editing &&
                !panning &&
                (!isAspectLocked(annotation)
                  ? [...CORNERS, ...EDGES]
                  : CORNERS
                ).map(({ corner, label }) => (
                  <button
                    key={corner}
                    type="button"
                    className={`annotation-resize-handle ${corner}`}
                    data-testid={`resize-${corner}`}
                    aria-label={`${label}のサイズ変更`}
                    title={`${label}をドラッグしてサイズ変更`}
                    style={{
                      cursor: resizeCursor(corner, sideways),
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
              placeholder={
                draft.fontReady
                  ? "ここに文字を入力"
                  : draft.fontError
                    ? "フォントを読み込めませんでした"
                    : "フォントを読み込み中…"
              }
              value={draft.annotation.text || ""}
              spellCheck={false}
              maxLength={3000}
              disabled={readOnly || !draft.fontReady}
              style={{
                fontFamily: fontCssFamily(draft.annotation.fontFamily),
                fontSize: (draft.annotation.fontSize || 16) * scale,
                fontWeight: draft.annotation.fontWeight || 400,
                fontStyle: draft.annotation.fontStyle || "normal",
                textDecoration: draft.annotation.underline
                  ? "underline"
                  : "none",
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
                disabled={readOnly || !draft.fontReady}
                onPointerDown={(event) => event.preventDefault()}
                onClick={commitDraft}
              >
                完了
              </button>
              <button
                type="button"
                aria-label="文字入力をキャンセル"
                disabled={readOnly}
                onPointerDown={(event) => event.preventDefault()}
                onClick={cancelDraft}
              >
                キャンセル
              </button>
              <span>改行 Enter · 確定 Ctrl / ⌘ + Enter</span>
            </div>
          </div>
        )}
        {shapeStyle && !readOnly && !panning && (
          <div
            className="shape-input-layer"
            data-testid="shape-input-layer"
            onPointerDown={(event) => {
              if (event.button !== 0 || isGesturePointer(event.pointerId)) return;
              if (shapeGesture.current) { clearShapeGesture(); return; }
              event.preventDefault();
              event.stopPropagation();
              commitDraft();
              const start = toInkPoint(event.clientX, event.clientY);
              shapeGesture.current = { pointerId: event.pointerId, start, clientX: event.clientX, clientY: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => { event.stopPropagation(); moveShape(event); }}
            onPointerUp={(event) => { event.stopPropagation(); finishShape(event); }}
            onPointerCancel={(event) => { event.stopPropagation(); clearShapeGesture(); }}
            onLostPointerCapture={clearShapeGesture}
          >
            {shapePreview && (() => {
              const { width, height } = shapePreview;
              const lineShape = shapeStyle.shapeKind === 'line' || shapeStyle.shapeKind === 'double-line';
              const strokeColor = lineShape && shapeStyle.strokeColor === 'none' ? '#000000' : shapeStyle.strokeColor ?? '#000000';
              const strokeWidth = strokeColor === 'none' ? 0 : Math.min(Math.max(0, lineShape ? Math.max(0.5, shapeStyle.strokeWidth ?? 1.5) : shapeStyle.strokeWidth ?? 1.5), 20, width, height);
              const inset = strokeWidth / 2;
              return <svg
                className="shape-placement-preview"
                data-testid="shape-placement-preview"
                style={{ left: shapePreview.x * scale, top: shapePreview.y * scale, width: width * scale, height: height * scale }}
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <g fill={lineShape || shapeStyle.fillColor === 'none' ? 'none' : shapeStyle.fillColor ?? 'none'} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round">
                  {lineShape ? shapeLineSegments(shapeStyle.shapeKind as 'line' | 'double-line', width, height, strokeWidth, shapePreview.lineDirection).map((segment, index) =>
                    <line key={index} {...segment} />)
                    : shapeStyle.shapeKind === 'ellipse'
                      ? <ellipse cx={width / 2} cy={height / 2} rx={Math.max(0, width / 2 - inset)} ry={Math.max(0, height / 2 - inset)} />
                      : shapeStyle.shapeKind === 'triangle'
                        ? <polygon points={`${width / 2},${inset} ${width - inset},${height - inset} ${inset},${height - inset}`} />
                        : <rect x={inset} y={inset} width={Math.max(0, width - inset * 2)} height={Math.max(0, height - inset * 2)} />}
                </g>
              </svg>;
            })()}
          </div>
        )}
        {inkTool && !readOnly && !panning && (
          <div
            className={`ink-input-layer ${inkTool}`}
            data-testid="ink-input-layer"
            onPointerDown={(event) => {
              if (event.button !== 0 || isGesturePointer(event.pointerId)) return;
              if (inkGesture.current) { clearInkGesture(); return; }
              event.preventDefault();
              event.stopPropagation();
              const point = toInkPoint(event.clientX, event.clientY);
              const gesture: InkGesture = { pointerId: event.pointerId, kind: inkTool, points: [point], straight: event.shiftKey, lastPoint: point, eraseIds: new Set() };
              inkGesture.current = gesture;
              if (inkTool === 'eraser') { setEraserPoint(point); collectEraseHits(point, gesture); }
              else setInkPreview([point]);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => { event.stopPropagation(); moveInk(event); }}
            onPointerUp={(event) => { event.stopPropagation(); finishInk(event); }}
            onPointerCancel={(event) => { event.stopPropagation(); clearInkGesture(); }}
            onLostPointerCapture={() => clearInkGesture()}
            onPointerLeave={() => { if (!inkGesture.current) setEraserPoint(null); }}
          >
            <svg viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none" aria-hidden="true">
              {inkPreview && (inkPreview.length === 1
                ? inkTool === 'marker' && markerCap === 'square'
                  ? <rect x={inkPreview[0].x - inkWidth / 2} y={inkPreview[0].y - inkWidth / 2} width={inkWidth} height={inkWidth} fill={inkColor} opacity={0.35} />
                  : <circle cx={inkPreview[0].x} cy={inkPreview[0].y} r={inkWidth / 2} fill={inkColor} opacity={inkTool === 'marker' ? 0.35 : 1} />
                : <polyline points={inkPreview.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={inkColor} strokeWidth={inkWidth} strokeLinecap={inkTool === 'marker' && markerCap === 'square' ? 'square' : 'round'} strokeLinejoin={inkTool === 'marker' && markerCap === 'square' ? 'miter' : 'round'} opacity={inkTool === 'marker' ? 0.35 : 1} />)}
              {inkTool === 'eraser' && eraserPoint && <circle cx={eraserPoint.x} cy={eraserPoint.y} r={8} fill="#ffffff55" stroke="#297c6c" strokeWidth={1.5} />}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
