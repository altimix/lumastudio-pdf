import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Files, FileText, GripVertical, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import "./merge-dialog.css";

export interface MergeFile {
  id: string;
  name: string;
  bytes: Uint8Array;
}

interface MergeDialogProps {
  files: MergeFile[];
  hasDocument: boolean;
  busy: boolean;
  error?: string;
  onFilesChange(files: MergeFile[]): void;
  onAddFiles(): void;
  onConfirm(): void;
  onClose(): void;
}

const MERGE_FILE_MIME = "application/x-luma-merge-file";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MergeDialog({ files, hasDocument, busy, error, onFilesChange, onAddFiles, onConfirm, onClose }: MergeDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (addRef.current ?? dialogRef.current)?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    // Keep the dialog keyboard-accessible while all action buttons are disabled.
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  const close = () => { if (!busy) onClose(); };
  const finishDrag = () => {
    draggingRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };
  const dropFile = (targetId: string, after: boolean, transferredId: string) => {
    const movingId = draggingRef.current;
    finishDrag();
    if (busy || !movingId || transferredId !== movingId || movingId === targetId) return;
    const moving = files.find(file => file.id === movingId);
    if (!moving) return;
    const next = files.filter(file => file.id !== movingId);
    const targetIndex = next.findIndex(file => file.id === targetId);
    if (targetIndex === -1) return;
    const destination = targetIndex + (after ? 1 : 0);
    next.splice(destination, 0, moving);
    if (next.every((file, index) => file === files[index])) return;
    onFilesChange(next);
    setAnnouncement(`${moving.name}を${destination + 1}番目に移動しました。`);
  };
  const move = (index: number, delta: number) => {
    const destination = index + delta;
    if (busy || destination < 0 || destination >= files.length) return;
    const next = [...files];
    [next[index], next[destination]] = [next[destination], next[index]];
    onFilesChange(next);
    setAnnouncement(`${files[index].name}を${destination + 1}番目に移動しました。`);
  };
  const remove = (index: number) => {
    if (busy) return;
    onFilesChange(files.filter((_, fileIndex) => fileIndex !== index));
    setAnnouncement(`${files[index].name}を結合する一覧から外しました。`);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  return (
    <div
      className="modal-backdrop merge-backdrop"
      onClick={close}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); finishDrag(); }}
    >
      <section
        ref={dialogRef}
        className="modal merge-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']");
            if (!controls?.length) { event.preventDefault(); return; }
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
              event.preventDefault(); first.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <div><Files size={23}/><h2 id={titleId}>PDFを結合</h2></div>
          <button className="icon-button" type="button" aria-label="PDFの結合を閉じる" onClick={close} disabled={busy}><X size={20}/></button>
        </div>
        <p id={descriptionId} className="merge-intro">
          {hasDocument ? "開いているPDFの最後に、下のPDFを上から順に追加します。" : "下のPDFを上から順にまとめて、1つのPDFにします。"}
          <br/>ドラッグ＆ドロップや矢印で順序を変えられます。
        </p>
        {hasDocument && <div className="merge-current"><FileText size={18}/><span>先頭：開いているPDF（現在の編集を含む）</span></div>}
        <div className="merge-list-heading"><span>{hasDocument ? "追加するPDF" : "結合するPDF"}</span><span>{files.length}ファイル</span></div>
        {files.length > 0 ? (
          <ol className="merge-file-list" aria-label="PDFの結合順序">
            {files.map((file, index) => (
              <li
                key={file.id}
                data-merge-file-id={file.id}
                data-merge-file-name={file.name}
                draggable={!busy}
                className={[
                  draggingId === file.id ? "merge-file-dragging" : "",
                  dropTarget?.id === file.id ? (dropTarget.after ? "merge-drop-after" : "merge-drop-before") : "",
                ].filter(Boolean).join(" ")}
                onDragStart={event => {
                  if (busy) { event.preventDefault(); return; }
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(MERGE_FILE_MIME, file.id);
                  draggingRef.current = file.id;
                  setDraggingId(file.id);
                }}
                onDragEnd={finishDrag}
                onDragOver={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (busy || !draggingRef.current || !event.dataTransfer.types.includes(MERGE_FILE_MIME)) {
                    event.dataTransfer.dropEffect = "none";
                    return;
                  }
                  event.dataTransfer.dropEffect = "move";
                  if (draggingRef.current === file.id) { setDropTarget(null); return; }
                  const rect = event.currentTarget.getBoundingClientRect();
                  const after = event.clientY >= rect.top + rect.height / 2;
                  setDropTarget(previous => previous?.id === file.id && previous.after === after ? previous : { id: file.id, after });
                }}
                onDragLeave={event => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                    setDropTarget(previous => previous?.id === file.id ? null : previous);
                  }
                }}
                onDrop={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  dropFile(file.id, event.clientY >= rect.top + rect.height / 2, event.dataTransfer.getData(MERGE_FILE_MIME));
                }}
              >
                <span className="merge-drag-handle" aria-hidden="true" title="ドラッグで順序を変更"><GripVertical size={17}/></span>
                <span className="merge-file-order" aria-hidden="true">{index + 1}</span>
                <FileText className="merge-file-icon" size={20}/>
                <div className="merge-file-info"><strong title={file.name}>{file.name}</strong><small>{formatSize(file.bytes.byteLength)}</small></div>
                <div className="merge-file-controls">
                  <button className="icon-button" type="button" aria-label={`${index + 1}番目の「${file.name}」を上へ移動`} title="上へ移動" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={17}/></button>
                  <button className="icon-button" type="button" aria-label={`${index + 1}番目の「${file.name}」を下へ移動`} title="下へ移動" disabled={busy || index === files.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17}/></button>
                  <button className="icon-button merge-remove" type="button" aria-label={`${index + 1}番目の「${file.name}」を一覧から外す`} title="一覧から外す" disabled={busy} onClick={() => remove(index)}><Trash2 size={16}/></button>
                </div>
              </li>
            ))}
          </ol>
        ) : <div className="merge-empty"><Files size={28}/><span>まとめたいPDFを選んでください</span></div>}
        <button ref={addRef} className="secondary full merge-add" type="button" onClick={onAddFiles} disabled={busy}><Plus size={17}/>PDFを追加で選ぶ</button>
        {error && <p className="inline-error merge-error" role="alert">{error}</p>}
        <span className="merge-announcement" role="status" aria-live="polite">{announcement}</span>
        <div className="modal-actions">
          <button className="secondary" type="button" disabled={busy} onClick={close}>キャンセル</button>
          <button className="primary" type="button" disabled={busy || files.length === 0} onClick={onConfirm}>
            {busy ? <LoaderCircle className="merge-spinner" size={17}/> : <Files size={17}/>}
            {busy ? "結合しています" : "この順序で結合"}
          </button>
        </div>
      </section>
    </div>
  );
}
