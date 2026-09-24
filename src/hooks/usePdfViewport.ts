import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

export const MIN_PDF_SCALE = 0.2;
export const MAX_PDF_SCALE = 4;

type Point = { x: number; y: number };
type Anchor = Point & { fractionX: number; fractionY: number };
type Pan = {
  pointerId: number;
  start: Point;
  scrollLeft: number;
  scrollTop: number;
  started: boolean;
};
type Pinch = {
  ids: [number, number];
  distance: number;
  scale: number;
  anchor: Anchor;
};

export function boundPdfScale(value: number, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_PDF_SCALE, Math.max(MIN_PDF_SCALE, value));
}

function interactiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input, textarea, select, button, a, [contenteditable='true'], [role='button'], [role='slider']",
      ),
    )
  );
}

function pageAnchor(workspace: HTMLElement, point: Point): Anchor | null {
  const page = workspace.querySelector<HTMLElement>(".page-outer");
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    ...point,
    fractionX: (point.x - rect.left) / rect.width,
    fractionY: (point.y - rect.top) / rect.height,
  };
}

function preserveAnchor(workspace: HTMLElement, anchor: Anchor) {
  const page = workspace.querySelector<HTMLElement>(".page-outer");
  if (!page) return;
  const rect = page.getBoundingClientRect();
  // Browser scroll clamping handles the edges when the whole page fits.
  workspace.scrollLeft += rect.left + rect.width * anchor.fractionX - anchor.x;
  workspace.scrollTop += rect.top + rect.height * anchor.fractionY - anchor.y;
}

function capture(workspace: HTMLElement, pointerId: number) {
  try {
    workspace.setPointerCapture(pointerId);
  } catch {
    // Pointer capture can be unavailable after cancellation or window blur.
  }
}

function release(workspace: HTMLElement | null, pointerId: number) {
  try {
    if (workspace?.hasPointerCapture(pointerId))
      workspace.releasePointerCapture(pointerId);
  } catch {
    // The browser may have already released an ended pointer.
  }
}

export function usePdfViewport({
  workspaceRef,
  scale,
  setScale,
  pageKey,
  handTool,
}: {
  workspaceRef: RefObject<HTMLDivElement | null>;
  scale: number;
  setScale: Dispatch<SetStateAction<number>>;
  pageKey: string;
  handTool: boolean;
}) {
  const scaleRef = useRef(scale);
  const handToolRef = useRef(handTool);
  const spaceHeld = useRef(false);
  const touches = useRef(new Map<number, Point>());
  const consumed = useRef(new Set<number>());
  const pan = useRef<Pan | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const pendingAnchor = useRef<Anchor | null>(null);
  const [panning, setPanning] = useState(false);
  scaleRef.current = scale;
  handToolRef.current = handTool;

  const changeScale = useCallback(
    (value: number, anchor: Anchor | null) => {
      const next = boundPdfScale(value, scaleRef.current);
      const workspace = workspaceRef.current;
      if (next === scaleRef.current) {
        if (workspace && anchor) preserveAnchor(workspace, anchor);
        return;
      }
      pendingAnchor.current = anchor;
      scaleRef.current = next;
      setScale(next);
    },
    [setScale, workspaceRef],
  );

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (workspace && anchor) preserveAnchor(workspace, anchor);
  }, [scale, workspaceRef]);

  const zoomTo = useCallback(
    (next: number) => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      const rect = workspace.getBoundingClientRect();
      changeScale(
        next,
        pageAnchor(workspace, {
          x: rect.left + workspace.clientWidth / 2,
          y: rect.top + workspace.clientHeight / 2,
        }),
      );
    },
    [changeScale, workspaceRef],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      zoomTo(scaleRef.current + delta);
    },
    [zoomTo],
  );

  const stopGestures = useCallback(() => {
    const workspace = workspaceRef.current;
    const ids = [...touches.current.keys()];
    if (pan.current) ids.push(pan.current.pointerId);
    for (const id of ids) consumed.current.add(id);
    touches.current.clear();
    pan.current = null;
    pinch.current = null;
    spaceHeld.current = false;
    setPanning(false);
    for (const id of ids) release(workspace, id);
  }, [workspaceRef]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !workspace.querySelector(".page-outer")) return;
      event.preventDefault();
      // Chromium reports trackpad pinch as a Ctrl+wheel gesture. Ordinary
      // wheel/two-finger scrolling remains native to this scroll container.
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? workspace.clientHeight
            : 1;
      const exponent = Math.max(-4, Math.min(4, -event.deltaY * unit * 0.002));
      changeScale(
        scaleRef.current * Math.exp(exponent),
        pageAnchor(workspace, {
          x: event.clientX,
          y: event.clientY,
        }),
      );
    };
    workspace.addEventListener("wheel", wheel, { passive: false });
    return () => workspace.removeEventListener("wheel", wheel);
  }, [changeScale, workspaceRef, pageKey]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const workspace = workspaceRef.current;
      if (
        event.code !== "Space" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        interactiveTarget(event.target) ||
        !workspace?.querySelector(".page-outer")
      )
        return;
      // Do not take Space away from other focused application controls.
      if (
        event.target instanceof Node &&
        event.target !== document.body &&
        !workspace.contains(event.target)
      )
        return;
      spaceHeld.current = true;
      event.preventDefault();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", stopGestures);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", stopGestures);
    };
  }, [stopGestures, workspaceRef]);

  useEffect(() => {
    pendingAnchor.current = null;
    stopGestures();
    return stopGestures;
  }, [pageKey, stopGestures]);

  const isGesturePointer = useCallback(
    (id: number) => consumed.current.has(id),
    [],
  );

  const onPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const workspace = workspaceRef.current;
      if (!workspace?.querySelector(".page-outer")) return;
      consumed.current.delete(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      if (event.pointerType === "touch") {
        touches.current.set(event.pointerId, point);
        if (touches.current.size >= 2) {
          const entries = [...touches.current.entries()];
          const [[firstId, first], [secondId, second]] = entries;
          for (const [id] of entries) {
            consumed.current.add(id);
            capture(workspace, id);
          }
          if (!pinch.current) {
            const anchor = pageAnchor(workspace, {
              x: (first.x + second.x) / 2,
              y: (first.y + second.y) / 2,
            });
            if (anchor)
              pinch.current = {
                ids: [firstId, secondId],
                distance: Math.max(
                  1,
                  Math.hypot(second.x - first.x, second.y - first.y),
                ),
                scale: scaleRef.current,
                anchor,
              };
          }
          pan.current = null;
          setPanning(true);
          event.preventDefault();
          return;
        }
      }
      // An active inline editor and resize handles keep their own pointer actions.
      const editable =
        event.target instanceof Element &&
        Boolean(
          event.target.closest(
            "input, textarea, select, [contenteditable='true'], .inline-text-editor, .inline-text-actions, .annotation-resize-handle, .resize-handle",
          ),
        );
      const immediate =
        !editable &&
        ((event.button === 0 && (handToolRef.current || spaceHeld.current)) ||
          event.button === 1);
      const backgroundTouch =
        !editable &&
        event.pointerType === "touch" &&
        !interactiveTarget(event.target) &&
        !(
          event.target instanceof Element && event.target.closest(".annotation, .ink-input-layer, .shape-input-layer")
        );
      if (!immediate && !backgroundTouch) return;
      pan.current = {
        pointerId: event.pointerId,
        start: point,
        scrollLeft: workspace.scrollLeft,
        scrollTop: workspace.scrollTop,
        started: immediate,
      };
      if (immediate) {
        consumed.current.add(event.pointerId);
        capture(workspace, event.pointerId);
        setPanning(true);
        event.preventDefault();
      }
    },
    [workspaceRef],
  );

  const onPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      if (touches.current.has(event.pointerId))
        touches.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
      const gesture = pinch.current;
      if (gesture) {
        const first = touches.current.get(gesture.ids[0]);
        const second = touches.current.get(gesture.ids[1]);
        if (first && second) {
          event.preventDefault();
          const distance = Math.max(
            1,
            Math.hypot(second.x - first.x, second.y - first.y),
          );
          changeScale((gesture.scale * distance) / gesture.distance, {
            ...gesture.anchor,
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          });
        }
        return;
      }
      const moving = pan.current;
      if (!moving || moving.pointerId !== event.pointerId) return;
      const dx = event.clientX - moving.start.x;
      const dy = event.clientY - moving.start.y;
      if (!moving.started && Math.hypot(dx, dy) <= 7) return;
      if (!moving.started) {
        moving.started = true;
        consumed.current.add(event.pointerId);
        capture(workspace, event.pointerId);
        setPanning(true);
      }
      event.preventDefault();
      workspace.scrollLeft = moving.scrollLeft - dx;
      workspace.scrollTop = moving.scrollTop - dy;
    },
    [changeScale, workspaceRef],
  );

  const endPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      touches.current.delete(event.pointerId);
      if (pinch.current?.ids.includes(event.pointerId)) pinch.current = null;
      if (pan.current?.pointerId === event.pointerId) pan.current = null;
      // Keep consumed IDs through the child pointerup handler. The next down for
      // that ID starts a fresh edit; the remaining finger after a pinch cannot.
      if (!pinch.current && !pan.current) setPanning(false);
      release(workspaceRef.current, event.pointerId);
    },
    [workspaceRef],
  );

  const onLostPointerCaptureCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Ignore capture being transferred from an annotation to the workspace.
      if (event.target === workspaceRef.current) endPointer(event);
    },
    [endPointer, workspaceRef],
  );

  return {
    viewportHandlers: {
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture: endPointer,
      onPointerCancelCapture: endPointer,
      onLostPointerCaptureCapture,
    },
    isGesturePointer,
    panning,
    zoomTo,
    zoomBy,
  };
}
