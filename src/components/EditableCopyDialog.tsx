import { useEffect, useRef, useState } from "react";
import { Copy, LockKeyhole, X } from "lucide-react";
import "./editable-copy.css";

export type EditableCopyReason = "password" | "restricted" | "signed";

export function EditableCopyDialog({
  reason,
  fileName,
  busy,
  error,
  onConvert,
  onClose,
}: {
  reason: EditableCopyReason;
  fileName: string;
  busy: boolean;
  error: string;
  onConvert(password: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [password, setPassword] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>(reason === "password" ? "input" : "button.primary")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [reason]);
  const close = () => {
    if (busy) return;
    setPassword("");
    onClose();
  };
  const submit = () => {
    if (busy || (reason === "password" && !password)) return;
    const entered = password;
    setPassword("");
    onConvert(entered);
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="editable-copy-title"
        className="modal editable-copy-dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key === "Tab") {
            const elements = ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)");
            if (!elements?.length) return;
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
              event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <div><Copy size={21} /><h2 id="editable-copy-title">編集用コピーを作成</h2></div>
          <button className="icon-button" aria-label="編集用コピー画面を閉じる" disabled={busy} onClick={close}><X size={19} /></button>
        </div>
        <p className="editable-copy-file">{fileName}</p>
        <p>
          {reason === "password" ? "このPDFを開くためのパスワードを入力してください。" :
            reason === "signed" ? "このPDFには電子署名が含まれています。署名を保持したまま編集することはできません。" :
              "このPDFには編集・保存の制限があります。閲覧できるページから新しいPDFを作成します。"}
        </p>
        {reason === "password" && (
          <label>
            PDFを開くパスワード
            <input
              type="password"
              value={password}
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
            />
          </label>
        )}
        <div className="editable-copy-warning">
          <LockKeyhole size={18} aria-hidden="true" />
          <p>元のPDFは変更しません。新しいコピーではページを画像化するため、元の文字検索・リンク・フォーム欄・暗号化・電子署名は引き継がれません。署名が必要な場合は、編集後に新しく署名してください。</p>
        </div>
        <p className="help-text">コピーは端末内で作成し、PDFやパスワードを外部へ送信しません。</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="text-button" disabled={busy} onClick={close}>キャンセル</button>
          <button className="primary" disabled={busy || (reason === "password" && !password)} onClick={submit}>
            {busy ? "コピーを作成中…" : "編集用コピーを作成"}
          </button>
        </div>
      </section>
    </div>
  );
}
