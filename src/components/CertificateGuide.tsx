import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  X,
} from "lucide-react";
import "./certificate-guide.css";

const helpLinks = {
  "moj-file-certificate": {
    url: "https://www.moj.go.jp/MINJI/minji06_00256.html",
    label: "法務省：ファイル形式の電子証明書",
  },
  "moj-certificate-process": {
    url: "https://www.moj.go.jp/MINJI/minji06_00086",
    label: "法務省：取得のご案内",
  },
  "secom-gid": {
    url: "https://www.secomtrust.net/service/ninsyo/forgid.html",
    label: "セコム：個人向け電子証明書の例",
  },
  "adobe-validate": {
    url: "https://helpx.adobe.com/acrobat/desktop/e-sign-documents/manage-digital-signatures/validate-digital-sign.html",
    label: "Adobe：署名の確認方法",
  },
} as const;

type HelpId = keyof typeof helpLinks;

export const CERTIFICATE_INQUIRY = `PDF文書への電子署名に利用する証明書を探しています。
RSA 2048ビット以上で、署名用の秘密鍵を含むP12／PFX（PKCS#12）ファイルを取得できますか。
PDF文書への署名に利用できる契約・用途か、Windows／Macでの取得方法、本人確認に必要な書類と費用・所要日数を教えてください。
受取先が受け付ける証明書の種類や、Adobe Acrobatでの信頼設定についても確認したいです。
使用するアプリはLumaStudio PDFです。ICカード・USBトークン・クラウド署名・タイムスタンプには未対応です。`;

export function CertificateGuide({
  onClose,
  onChooseCertificate,
}: {
  onClose(): void;
  onChooseCertificate?(): void;
}) {
  const titleId = useId();
  const introId = useId();
  const holderId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const inquiryRef = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const [holder, setHolder] = useState<"personal" | "company">("personal");
  const [copyStatus, setCopyStatus] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    alive.current = true;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    return () => {
      alive.current = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const copyInquiry = async () => {
    try {
      await navigator.clipboard.writeText(CERTIFICATE_INQUIRY);
      if (alive.current)
        setCopyStatus(
          "コピーしました。問い合わせ先の入力欄に貼り付けてください。",
        );
    } catch {
      if (!alive.current) return;
      inquiryRef.current?.focus();
      inquiryRef.current?.select();
      setCopyStatus(
        "文章を選択しました。Ctrl+C（Macは⌘C）でコピーしてください。",
      );
    }
  };

  const officialLink = (id: HelpId) => {
    const link = helpLinks[id];
    return (
      <a
        className="certificate-official-link"
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!window.lumaDesktop) return;
          event.preventDefault();
          setLinkError("");
          const desktop = window.lumaDesktop as typeof window.lumaDesktop & {
            openHelpLink?(id: string): Promise<void>;
          };
          if (!desktop.openHelpLink) {
            setLinkError(`ブラウザーで次のURLを開いてください：${link.url}`);
            return;
          }
          void desktop.openHelpLink(id).catch(() => {
            if (alive.current)
              setLinkError(
                `リンクを開けませんでした。ブラウザーで次のURLを開いてください：${link.url}`,
              );
          });
        }}
      >
        {link.label}
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    );
  };

  return (
    <div
      className="modal-backdrop certificate-guide-backdrop"
      onClick={onClose}
    >
      <section
        ref={dialogRef}
        className="modal certificate-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key !== "Tab") return;
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
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
        }}
      >
        <div className="modal-heading">
          <div>
            <BookOpen size={23} />
            <h2 id={titleId}>はじめての署名用証明書</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="証明書ガイドを閉じる"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p id={introId} className="certificate-guide-intro">
          証明書を持っていなくても大丈夫です。提出先への確認から、このアプリで署名するまでをご案内します。
        </p>
        <div className="certificate-guide-body">
          <dl className="certificate-guide-difference">
            <div>
              <dt>印影画像</dt>
              <dd>PDFに見た目の印鑑を置きます。</dd>
            </div>
            <div>
              <dt>電子証明書</dt>
              <dd>
                署名者の情報と、署名後の変更を確かめるために使います。画像とは別に取得します。
              </dd>
            </div>
          </dl>
          <ol className="certificate-guide-steps">
            <li>
              <h3>提出先に、使える証明書を聞く</h3>
              <p>
                銀行・取引先などに「PDFへの電子署名で提出できますか。指定の証明書やサービスはありますか」と確認します。個人名で署名するか、会社の代表者として署名するかも決めましょう。
              </p>
              <p className="certificate-step-note">
                指定サービスでの署名が必要な場合は、提出先の案内に従ってください。
              </p>
            </li>
            <li>
              <h3>取得先とファイル形式を確認する</h3>
              <fieldset className="certificate-holder">
                <legend>だれの名義で署名しますか？</legend>
                <label>
                  <input
                    type="radio"
                    name={holderId}
                    checked={holder === "personal"}
                    onChange={() => setHolder("personal")}
                  />
                  個人・個人事業主
                </label>
                <label>
                  <input
                    type="radio"
                    name={holderId}
                    checked={holder === "company"}
                    onChange={() => setHolder("company")}
                  />
                  会社・法人の代表者
                </label>
              </fieldset>
              {holder === "personal" ? (
                <div className="certificate-issuer">
                  <p>
                    本人確認を行う認証事業者に、PDF文書への署名に使う証明書を相談します。国内の個人向けには、セコムパスポート
                    for G-IDなどがあります。
                  </p>
                  {officialLink("secom-gid")}
                  <p className="certificate-step-note">
                    セコムの公式サポート対象はWindowsです。Macを使う方は、取得方法と利用条件を申請前に確認してください。
                  </p>
                </div>
              ) : (
                <div className="certificate-issuer">
                  <p>
                    商業・法人登記に基づく代表者の証明書は、法務省の取得案内を確認します。このアプリで使うのは
                    <strong>ファイル形式</strong>
                    です。商業登記リモート署名には対応していません。
                  </p>
                  {officialLink("moj-file-certificate")}
                  {officialLink("moj-certificate-process")}
                </div>
              )}
              <p className="certificate-file-requirement">
                <strong>
                  必要なのは、秘密鍵を含む .p12 ／ .pfx ファイル。
                </strong>
                <span>
                  署名に使う大切な鍵が入ったファイルです。RSA
                  2048ビット以上の署名用証明書に対応しています。.cer／.crtだけでは署名できません。
                </span>
              </p>
              <p className="certificate-step-note">
                リンクは取得先の例です。本アプリとの組み合わせを実証したものではありません。購入・申請の前に、用途・形式・提出先での受理を確認してください。
              </p>
              <details className="certificate-inquiry">
                <summary>取得先への問い合わせ文を使う</summary>
                <label>
                  コピーして使える問い合わせ文
                  <textarea
                    ref={inquiryRef}
                    value={CERTIFICATE_INQUIRY}
                    readOnly
                    rows={6}
                  />
                </label>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void copyInquiry()}
                >
                  {copyStatus.startsWith("コピーしました") ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                  問い合わせ文をコピー
                </button>
                <p role="status">{copyStatus}</p>
              </details>
            </li>
            <li>
              <h3>申し込み・本人確認をして受け取る</h3>
              <p>
                取得先の公式サイトで対象者・必要書類・料金・取得までの日数を確認し、案内に沿って申し込みます。審査後、証明書ファイルとそのパスワードを用意します。取得に使えるOSは取得先によって異なります。本アプリはWindows／Macの両方でP12／PFX形式を扱います。
              </p>
            </li>
            <li>
              <h3>証明書とパスワードを安全に保管する</h3>
              <p>
                証明書ファイルは自分だけが使える場所へ保存し、パスワードは別に保管します。メールの返送時に添付するのは完成したPDFだけです。証明書・秘密鍵・パスワードは相手に渡しません。
              </p>
            </li>
            <li>
              <h3>このアプリで確認して署名する</h3>
              <p>
                Windows／Macのデスクトップ版で編集と押印を終え、「署名して保存」から証明書を選択します。パスワードを入力して「証明書を確認」を押し、署名者・発行者・有効期間を確かめてから保存してください。
              </p>
              <p>
                返送前に、署名付きPDFをAdobe
                Acrobatなどで開いて署名を確認します。修正するときは署名前の作業データに戻って編集し、もう一度署名します。
              </p>
              {officialLink("adobe-validate")}
            </li>
          </ol>
          <aside
            className="certificate-guide-support"
            aria-label="このバージョンの対応範囲"
          >
            <h3>手元の証明書が使えるか迷ったら</h3>
            <p>
              マイナンバーカード、ICカード、USBトークン、クラウド署名、OSの証明書一覧からの直接利用は、このバージョンでは未対応です。まず取得先に、上記のファイルを用意できるか確認してください。
            </p>
            <p>
              アプリで読み込めても、提出先が受理するとは限りません。受取側の信頼設定や失効状況の確認が必要です。タイムスタンプ・長期検証には未対応です。自己署名のテスト証明書は、第三者による本人確認を受けた証明書とは異なります。
            </p>
          </aside>
          {linkError && (
            <p role="alert" className="inline-error certificate-link-error">
              {linkError}
            </p>
          )}
          <p className="certificate-guide-updated">
            公式情報の確認日：2026年9月22日。最新の取得条件は各公式サイトで確認してください。
          </p>
        </div>
        <div className="modal-actions certificate-guide-actions">
          <button className="secondary" type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            ガイドを閉じる
          </button>
          {onChooseCertificate && (
            <button
              className="primary"
              type="button"
              onClick={onChooseCertificate}
            >
              <FolderOpen size={17} />
              取得済みの証明書を選ぶ
            </button>
          )}
          {!onChooseCertificate && (
            <span>
              <BadgeCheck size={16} />
              取得後はデスクトップ版の「署名して保存」へ
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
