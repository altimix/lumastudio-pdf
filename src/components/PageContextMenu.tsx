import { useEffect, useRef } from "react";
import { Download, Trash2 } from "lucide-react";

export type PageMenuTarget = {
  pageId: string;
  x: number;
  y: number;
  anchor: HTMLElement;
};

export function PageContextMenu({
  target,
  pageNumber,
  disabledReason,
  onDelete,
  onExport,
  exportDisabled,
  onClose,
}: {
  target: PageMenuTarget;
  pageNumber: number;
  disabledReason?: string;
  onDelete(): void;
  onExport(): void;
  exportDisabled?: boolean;
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (
      menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
      menu.current
    )?.focus({ preventScroll: true });
    const pointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const scroll = () => onClose();
    document.addEventListener("pointerdown", pointer);
    window.addEventListener("resize", scroll);
    document.addEventListener("wheel", scroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("pointerdown", pointer);
      window.removeEventListener("resize", scroll);
      document.removeEventListener("wheel", scroll, true);
    };
  }, [onClose, target.pageId]);
  return (
    <div
      ref={menu}
      className="page-context-menu"
      role="menu"
      aria-label="ページの操作"
      tabIndex={-1}
      style={{
        left: Math.max(8, Math.min(target.x, window.innerWidth - 244)),
        top: Math.max(8, Math.min(target.y, window.innerHeight - 178)),
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          if (!items.length) return;
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next].focus({ preventScroll: true });
          return;
        }
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
          target.anchor.focus();
        }
      }}
    >
      <div className="page-context-title">{pageNumber}ページ目</div>
      <button role="menuitem" disabled={exportDisabled} onClick={onExport}>
        <Download size={16} />
        このページをPDF保存
      </button>
      <button
        role="menuitem"
        className="danger"
        disabled={!!disabledReason}
        onClick={onDelete}
      >
        <Trash2 size={16} />
        このページを削除
      </button>
      <p>{disabledReason || "削除後も「元に戻す」で戻せます。"}</p>
    </div>
  );
}
