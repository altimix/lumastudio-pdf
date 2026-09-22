import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation, PageInfo } from "../lib/types";
import { annotationToDataUrl, renderPdfPage } from "../lib/pdf";

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

type Props = {
  document: PDFDocumentProxy;
  page: PageInfo;
  annotations: Annotation[];
  scale: number;
  selectedId: string | null;
  placing: boolean;
  onPlace(x: number, y: number): void;
  onSelect(id: string | null): void;
  onMove(id: string, x: number, y: number): void;
  onError(message: string): void;
};

export function PdfPage({
  document,
  page,
  annotations,
  scale,
  selectedId,
  placing,
  onPlace,
  onSelect,
  onMove,
  onError,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    originX: number;
    originY: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const scratch = window.document.createElement("canvas");
    renderPdfPage(document, page.sourceIndex, scratch, scale)
      .then(() => {
        if (!cancelled && canvasRef.current) {
          const canvas = canvasRef.current;
          canvas.width = scratch.width;
          canvas.height = scratch.height;
          canvas.getContext("2d")?.drawImage(scratch, 0, 0);
        }
      })
      .catch((error) => {
        if (!cancelled) onError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [document, page.sourceIndex, scale, onError]);
  const sideways = page.rotation % 180 !== 0;
  const outerWidth = (sideways ? page.height : page.width) * scale;
  const outerHeight = (sideways ? page.width : page.height) * scale;
  const toPoint = (clientX: number, clientY: number) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    const x = (clientX - rect.left) / scale,
      y = (clientY - rect.top) / scale;
    if (page.rotation === 90) return { x: y, y: page.height - x };
    if (page.rotation === 180) return { x: page.width - x, y: page.height - y };
    if (page.rotation === 270) return { x: page.width - y, y: x };
    return { x, y };
  };
  return (
    <div
      className="page-outer"
      style={{ width: outerWidth, height: outerHeight }}
    >
      <div
        ref={surfaceRef}
        className={`pdf-surface ${placing ? "placing" : ""}`}
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
          const point = toPoint(event.clientX, event.clientY);
          if (placing) onPlace(point.x, point.y);
          else onSelect(null);
        }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        {annotations.map((annotation) => {
          const x = preview?.id === annotation.id ? preview.x : annotation.x;
          const y = preview?.id === annotation.id ? preview.y : annotation.y;
          return (
            <div
              key={annotation.id}
              role="button"
              tabIndex={0}
              aria-label={`${annotation.type === "stamp" ? "印鑑" : annotation.type === "text" ? "文字" : annotation.type === "check" ? "チェック" : "画像"}: ${annotation.text ?? ""}`}
              aria-pressed={selectedId === annotation.id}
              className={`annotation ${selectedId === annotation.id ? "selected" : ""}`}
              style={{
                left: x * scale,
                top: y * scale,
                width: annotation.width * scale,
                height: annotation.height * scale,
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(annotation.id);
                }
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(annotation.id);
                const point = toPoint(event.clientX, event.clientY);
                drag.current = {
                  id: annotation.id,
                  originX: annotation.x,
                  originY: annotation.y,
                  pointerX: point.x,
                  pointerY: point.y,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (drag.current?.id !== annotation.id) return;
                const point = toPoint(event.clientX, event.clientY);
                setPreview({
                  id: annotation.id,
                  x: Math.max(
                    0,
                    Math.min(
                      page.width - annotation.width,
                      drag.current.originX + point.x - drag.current.pointerX,
                    ),
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      page.height - annotation.height,
                      drag.current.originY + point.y - drag.current.pointerY,
                    ),
                  ),
                });
              }}
              onPointerUp={(event) => {
                if (preview?.id === annotation.id)
                  onMove(annotation.id, preview.x, preview.y);
                drag.current = null;
                setPreview(null);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setPreview(null);
              }}
            >
              <AnnotationVisual annotation={annotation} />
              {selectedId === annotation.id && (
                <>
                  <i className="selection-dot top" />
                  <i className="selection-dot bottom" />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
