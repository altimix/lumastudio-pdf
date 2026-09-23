import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, LockKeyhole, Trash2, X } from "lucide-react";
type Settings = Awaited<
  ReturnType<NonNullable<Window["lumaDesktop"]>["getAiSettings"]>
>;

export function AiSettingsDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gpt-6-sol");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const desktop = window.lumaDesktop;
  useEffect(() => {
    let active = true;
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    if (desktop?.getAiSettings)
      desktop
        .getAiSettings()
        .then((value) => {
          if (active) {
            setSettings(value);
            setModel(value.model);
          }
        })
        .catch(() => {
          if (active) setError("AI設定を読み込めませんでした。");
        });
    return () => {
      active = false;
      if (previous?.isConnected) previous.focus();
    };
  }, [desktop]);
  const close = () => {
    if (!busy) {
      setKey("");
      onClose();
    }
  };
  const save = async () => {
    if (!desktop || !settings) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const keyWasEntered = key.trim().length > 0;
      const value = await desktop.saveAiSettings({ key, model });
      setKey("");
      setSettings({ ...value, canStore: settings.canStore });
      setModel(value.model);
      setMessage(keyWasEntered
        ? "設定を保存しました。接続はAI自動記入を実行したときに確認します。"
        : "利用モデルを保存しました。接続はAI自動記入を実行したときに確認します。");
    } catch {
      setError(
        "保存できませんでした。設定の状態とOSの保管機能を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!desktop || !settings) return;
    setBusy(true);
    setError("");
    try {
      const value = await desktop.removeAiSettings();
      setSettings({ ...value, canStore: settings.canStore });
      setModel(value.model);
      setKey("");
      setMessage(
        value.source === "environment"
          ? "保存した設定を削除し、既存の環境設定に戻しました。"
          : "保存したAI設定を削除しました。",
      );
    } catch {
      setError("保存した設定を削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        className="modal"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            const elements = ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
            );
            if (!elements?.length) return;
            const first = elements[0],
              last = elements[elements.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <KeyRound size={22} />
            <h2 id="ai-settings-title">AIの設定</h2>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            onClick={close}
            aria-label="AI設定を閉じる"
          >
            <X size={20} />
          </button>
        </div>
        <p>
          AI自動記入を使う場合だけ、OpenAIのAPIキーを設定します。PDFの編集・印鑑・保存には不要です。
        </p>
        {!desktop?.getAiSettings ? (
          <p className="ai-disclosure">
            APIキーの登録はデスクトップ版で行えます。このブラウザー版は開発用の設定ファイルを使用します。
          </p>
        ) : (
          <>
            <p className="ai-disclosure">
              <Check size={18} />
              {settings?.available
                ? `設定済み（${settings.source === "saved" ? "この端末に保存した設定" : "既存の環境設定"}）`
                : settings ? "APIキーは未設定です" : "設定を確認しています"}
            </p>
            <label>
              OpenAI APIキー
              <input
                type="password"
                value={key}
                autoComplete="off"
                spellCheck={false}
                maxLength={1024}
                disabled={busy || !settings?.canStore}
                placeholder="sk-…"
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <p className="help-text">
              保存済みのキーは表示しません。変更する場合だけ、新しいキーを入力してください。
            </p>
            <label>
              利用モデル
              <select
                aria-label="利用モデル"
                value={model}
                disabled={busy}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="gpt-6-sol">GPT-6 Sol（標準）</option>
                <option value="gpt-6-luna">GPT-6 Luna（軽量）</option>
              </select>
            </label>
            <p className="help-text">モデルだけの変更なら、APIキーを入力し直す必要はありません。</p>
            <p className="help-text">
              <LockKeyhole size={13} />
              キーはOSの保管機能で暗号化して、この端末に保存します。AIの実行前には、送信するページと登録情報を確認できます。
            </p>
            {settings && !settings.canStore && (
              <p className="inline-error">
                この環境ではAPIキーを安全に保存できません。モデルだけの選択は保存できます。
              </p>
            )}
            {settings?.warning && (
              <p className="help-text">{settings.warning}</p>
            )}
            <div className="modal-actions">
              <button
                className="text-button danger"
                disabled={busy || !(settings?.hasStoredSettings ?? settings?.saved)}
                onClick={remove}
              >
                <Trash2 size={15} />
                保存したAI設定を削除
              </button>
              <button
                className="primary"
                onClick={save}
                disabled={busy || !settings || (key.trim().length > 0
                  ? !settings.canStore || key.trim().length < 20
                  : model === settings.model || Boolean(settings.warning && settings.hasStoredSettings))}
              >
                この端末に保存
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="help-text" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
