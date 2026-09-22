import { useEffect, useRef } from "react";
import { FolderOpen, Save, X } from "lucide-react";

export function ProjectDialog({
  busy,
  canSave,
  error,
  onSave,
  onOpen,
  onClose,
}: {
  busy: boolean;
  canSave: boolean;
  error: string;
  onSave(): void;
  onOpen(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title"
        className="modal project-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const buttons = ref.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
            if (!buttons?.length) return;
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <Save size={22} />
            <h2 id="project-title">編集の続きを保存・再開</h2>
          </div>
          <button
            className="icon-button"
            aria-label="作業データ画面を閉じる"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          元のPDFと、追加した文字・印鑑、ページの順番をまとめて保存します。後日開いて、続きから編集できます。
        </p>
        <button
          className="primary full"
          disabled={!canSave || busy}
          onClick={onSave}
        >
          <Save size={17} />
          作業データを保存
        </button>
        <p className="help-text">
          作業データ（.lumapdf）はLumaStudio
          PDFで開けます。メールに添付する完成版は「PDFを保存」で書き出してください。
        </p>
        <div className="section-divider" />
        <button className="secondary full" disabled={busy} onClick={onOpen}>
          <FolderOpen size={17} />
          保存した作業データを開く
        </button>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
