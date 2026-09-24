import { useEffect, useId, useRef } from "react";
import { BookOpen, Keyboard, X } from "lucide-react";
import "./help-dialog.css";

export type HelpSection = "manual" | "shortcuts";

const shortcuts = [
  ["PDFを開く", "Ctrl+O", "⌘O"],
  ["完成したPDFを保存", "Ctrl+S", "⌘S"],
  ["印刷", "Ctrl+P", "⌘P"],
  ["PDF編集を元に戻す", "Ctrl+Z", "⌘Z"],
  ["PDF編集をやり直す", "Ctrl+Shift+Z", "⌘Shift+Z"],
  ["選択中の素材を削除", "Delete / Backspace", "Delete"],
  ["選択中の素材を少し動かす", "方向キー", "方向キー"],
  ["選択中の素材を大きく動かす", "Shift+方向キー", "Shift+方向キー"],
  ["ペンで直線を引く", "Shift+ドラッグ", "Shift+ドラッグ"],
  ["文字入力を確定", "Ctrl+Enter", "⌘Enter"],
  ["描画の取消・全画面解除", "Esc", "Esc"],
] as const;

export function HelpDialog({ section, version, onSectionChange, onClose }: {
  section: HelpSection;
  version: string;
  onSectionChange(section: HelpSection): void;
  onClose(): void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        className="modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key !== "Tab") return;
          const controls = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          if (!controls?.length) { event.preventDefault(); return; }
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="field-eyebrow">LumaStudio PDF ヘルプ</span>
            <h2 id={titleId}>{section === "manual" ? "使い方マニュアル" : "ショートカット一覧"}</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="ヘルプを閉じる" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="help-tabs" role="group" aria-label="ヘルプの項目">
          <button type="button" aria-pressed={section === "manual"} onClick={() => onSectionChange("manual")}><BookOpen size={16} />使い方マニュアル</button>
          <button type="button" aria-pressed={section === "shortcuts"} onClick={() => onSectionChange("shortcuts")}><Keyboard size={16} />ショートカット一覧</button>
        </div>
        {section === "manual" ? (
          <div className="help-content help-manual">
            <div><h3>1. PDFを開く</h3><p>「開く」からPDFを選びます。ほかのアプリからPDFに印刷して取り込む場合は、画面右上の「印刷から取り込む」を確認してください。</p></div>
            <div><h3>2. 書き込む・押印する</h3><p>上の道具から文字、チェック、画像、図形、ペンなどを選び、用紙をクリックします。印鑑は名前で作るか画像を登録でき、クリックした位置が印鑑の中心になります。配置後は選択して位置や大きさを変更できます。</p></div>
            <div><h3>3. ページを整える</h3><p>左のページ一覧ではドラッグで並べ替え、右クリックでページを操作できます。表示中のページのすぐ上にも、前後への移動・右回転・削除があります。</p></div>
            <div><h3>4. 保存する</h3><p>「PDFを保存」またはCtrl+S（Macは⌘S）で完成したPDFを別名保存します。あとで編集を再開するなら「作業データ」から .lumapdf も保存してください。未保存のまま閉じるときは、どちらかを保存して終了できます。</p></div>
            <div><h3>AIと電子署名</h3><p>AI自動記入は明示的に実行した場合だけ文書を送信します。画像の印鑑は見た目の押印です。改変を検出する電子署名には、ご自身のP12／PFX証明書が必要です。</p></div>
          </div>
        ) : (
          <div className="help-content">
            <p className="help-intro">文字入力中は文字の編集が優先されます。PDFの変更を戻す場合は、入力を確定してから操作してください。</p>
            <table className="help-shortcuts"><thead><tr><th>操作</th><th>Windows</th><th>Mac</th></tr></thead><tbody>
              {shortcuts.map(([label, windows, mac]) => <tr key={label}><th scope="row">{label}</th><td>{windows}</td><td>{mac}</td></tr>)}
            </tbody></table>
          </div>
        )}
        <div className="help-footer">現在のバージョン v{version}。ポータブル版の更新は手動です。「ヘルプ」→「最新版・更新履歴を見る」から公開版を確認できます。</div>
      </section>
    </div>
  );
}
