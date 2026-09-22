import { useState } from "react";
import { X, UserRound, ShieldCheck } from "lucide-react";
export const PROFILE_FIELDS = [
  "氏名",
  "フリガナ",
  "会社名",
  "郵便番号",
  "住所",
  "電話番号",
  "メールアドレス",
  "銀行名",
  "支店名",
  "口座種別",
  "口座番号",
  "口座名義",
  "その他",
] as const;
export type Profile = Record<string, string>;
export function ProfileDialog({
  profile,
  onSave,
  onClose,
}: {
  profile: Profile;
  onSave(profile: Profile): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<Profile>({ ...profile });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        className="modal profile-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <UserRound size={22} />
            <h2 id="profile-title">よく使う情報</h2>
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="muted">
          登録した情報をワンクリックで配置できます。AI自動記入にも使います。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <div className="profile-grid">
            {PROFILE_FIELDS.map((field) => (
              <label
                key={field}
                className={field === "住所" || field === "その他" ? "wide" : ""}
              >
                {field}
                <input
                  maxLength={field === "その他" ? 1000 : 250}
                  autoComplete="off"
                  value={draft[field] ?? ""}
                  placeholder={field === "口座種別" ? "普通・当座など" : ""}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p className="privacy-note">
            <ShieldCheck size={16} />{" "}
            この端末に保存します。共有パソコンでは登録後に「登録情報を消去」を使ってください。
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="text-button danger"
              onClick={() => {
                if (confirm("この端末の登録情報を消去しますか？")) {
                  onSave({});
                }
              }}
            >
              登録情報を消去
            </button>
            <button className="primary" type="submit">
              この端末に登録
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
