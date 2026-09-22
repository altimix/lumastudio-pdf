import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  BookOpen,
  FileKey2,
  FolderOpen,
  Info,
  LoaderCircle,
  LockKeyhole,
  X,
} from "lucide-react";
import { CertificateGuide } from "./CertificateGuide";
import "./signature.css";

export interface SignOptions {
  password: string;
  reason: string;
  location: string;
}
export interface CertificateInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
  selfSigned: boolean;
}
interface CertificateDesktop {
  chooseCertificate(): Promise<{ name: string } | null>;
  inspectCertificate(password: string): Promise<CertificateInfo>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

export function SignatureDialog({
  onClose,
  onSign,
}: {
  onClose(): void;
  onSign(options: SignOptions): Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const guideRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const [certificate, setCertificate] = useState<{ name: string } | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [info, setInfo] = useState<CertificateInfo | null>(null);
  const [busy, setBusy] = useState<"choose" | "inspect" | "sign" | null>(null);
  const [error, setError] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const desktop = window.lumaDesktop as
    (typeof window.lumaDesktop & CertificateDesktop) | undefined;
  const available = Boolean(
    desktop?.chooseCertificate && desktop?.inspectCertificate,
  );

  useEffect(() => {
    alive.current = true;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    (chooseRef.current ?? dialogRef.current)?.focus();
    return () => {
      alive.current = false;
      previous?.focus();
    };
  }, []);
  useLayoutEffect(() => {
    if (certificate) passwordRef.current?.focus();
  }, [certificate]);
  const close = () => {
    if (busy) return;
    setPassword("");
    setInfo(null);
    setCertificate(null);
    onClose();
  };
  const choose = async () => {
    if (!available || !desktop || busy) return;
    // Changing a certificate invalidates its old password and inspection.
    setPassword("");
    setInfo(null);
    setCertificate(null);
    setError("");
    setBusy("choose");
    let selected: { name: string } | null = null;
    try {
      selected = await desktop.chooseCertificate();
      if (!alive.current) return;
      setCertificate(selected);
    } catch {
      if (alive.current)
        setError(
          "証明書ファイルを開けませんでした。もう一度選択してください。",
        );
    } finally {
      if (alive.current) {
        setBusy(null);
        if (!selected) requestAnimationFrame(() => chooseRef.current?.focus());
      }
    }
  };
  const inspect = async () => {
    if (!certificate || !desktop || busy) return;
    setBusy("inspect");
    setError("");
    setInfo(null);
    try {
      const inspected = await desktop.inspectCertificate(password);
      if (alive.current) setInfo(inspected);
    } catch {
      if (alive.current)
        setError(
          "証明書を確認できませんでした。パスワードとPFX／P12ファイルを確認してください。",
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const sign = async () => {
    if (!info || !certificate || busy) return;
    setBusy("sign");
    setError("");
    try {
      await onSign({
        password,
        reason: reason.trim(),
        location: location.trim(),
      });
      if (alive.current) {
        setPassword("");
        setInfo(null);
        onClose();
      }
    } catch {
      if (alive.current)
        setError(
          "電子署名付きPDFを保存できませんでした。証明書を確認して、もう一度お試しください。",
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  if (showGuide)
    return (
      <CertificateGuide
        onClose={() => {
          setShowGuide(false);
          requestAnimationFrame(() => guideRef.current?.focus());
        }}
        onChooseCertificate={
          available
            ? () => {
                setShowGuide(false);
                void choose();
              }
            : undefined
        }
      />
    );

  return (
    <div className="modal-backdrop signature-backdrop" onClick={close}>
      <section
        ref={dialogRef}
        className="modal signature-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            );
            if (!controls?.length) {
              event.preventDefault();
              return;
            }
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialogRef.current)
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
            <BadgeCheck size={23} />
            <h2 id={titleId}>電子署名して保存</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="電子署名を閉じる"
            onClick={close}
            disabled={!!busy}
          >
            <X size={20} />
          </button>
        </div>
        <p id={descriptionId} className="signature-intro">
          署名後は変更を検出できるPDFとして保存。印影のコピー自体を防ぐ機能ではありません。
        </p>
        <button
          ref={guideRef}
          className="signature-guide-button"
          type="button"
          onClick={() => setShowGuide(true)}
          disabled={!!busy}
        >
          <BookOpen size={16} />
          証明書を持っていない方へ
        </button>
        {!available ? (
          <div className="signature-notice">
            <Info size={18} />
            <p>
              電子署名にはデスクトップ版が必要です。WindowsまたはMacのLumaStudio
              PDFで開いてください。
            </p>
          </div>
        ) : (
          <>
            <div className="signature-file-card">
              <FileKey2 size={24} />
              <div>
                <span>署名用の証明書</span>
                <strong>
                  {certificate?.name || "証明書を選択してください"}
                </strong>
                <small>PFX／P12形式（秘密鍵を含むファイル）</small>
              </div>
            </div>
            <button
              ref={chooseRef}
              type="button"
              className="secondary full"
              onClick={choose}
              disabled={!!busy}
            >
              {busy === "choose" ? (
                <LoaderCircle className="signature-spinner" size={17} />
              ) : (
                <FolderOpen size={17} />
              )}
              証明書ファイルを選ぶ
            </button>
            {certificate && (
              <div className="signature-unlock">
                <label>
                  証明書のパスワード
                  <input
                    ref={passwordRef}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={password}
                    disabled={!!busy}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setInfo(null);
                      setError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void inspect();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={inspect}
                  disabled={!!busy}
                >
                  {busy === "inspect" ? (
                    <LoaderCircle className="signature-spinner" size={16} />
                  ) : (
                    <LockKeyhole size={16} />
                  )}
                  証明書を確認
                </button>
              </div>
            )}
            {info && (
              <div className="signature-details" aria-label="確認した証明書">
                <div className="signature-verified">
                  <BadgeCheck size={17} />
                  <span>証明書を読み込みました</span>
                </div>
                <dl>
                  <div>
                    <dt>署名者</dt>
                    <dd>{info.subject}</dd>
                  </div>
                  <div>
                    <dt>発行者</dt>
                    <dd>{info.issuer}</dd>
                  </div>
                  <div>
                    <dt>有効期間</dt>
                    <dd>
                      {formatDate(info.validFrom)} 〜 {formatDate(info.validTo)}
                    </dd>
                  </div>
                  <div>
                    <dt>フィンガープリント</dt>
                    <dd className="signature-fingerprint">
                      {info.fingerprint}
                    </dd>
                  </div>
                </dl>
                {info.selfSigned && (
                  <p className="signature-self-signed">
                    <Info size={16} />
                    <span>
                      自己署名証明書です。受信側の信頼設定が必要です。
                    </span>
                  </p>
                )}
              </div>
            )}
            <div className="signature-options">
              <label>
                署名の理由 <span>任意</span>
                <input
                  value={reason}
                  maxLength={250}
                  placeholder="例：内容を確認しました"
                  disabled={!!busy}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label>
                署名地 <span>任意</span>
                <input
                  value={location}
                  maxLength={150}
                  placeholder="例：東京"
                  disabled={!!busy}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </label>
            </div>
            <p className="signature-private">
              <LockKeyhole size={14} />
              証明書とパスワードは端末内で使います。パスワードは登録・保存しません。
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="inline-error signature-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            type="button"
            disabled={!!busy}
            onClick={close}
          >
            キャンセル
          </button>
          <button
            className="primary"
            type="button"
            disabled={!available || !info || !!busy}
            onClick={sign}
          >
            {busy === "sign" ? (
              <LoaderCircle className="signature-spinner" size={17} />
            ) : (
              <BadgeCheck size={17} />
            )}{" "}
            {busy === "sign" ? "署名して保存中" : "電子署名してPDFを保存"}
          </button>
        </div>
      </section>
    </div>
  );
}
