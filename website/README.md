# LumaStudio PDF 公式サイト

`https://lumastudiopdf.altimix.jp/` で公開する静的サイトです。アプリ本体のVite/Electronビルドとは独立しています。

- HTML/CSSと本人提供写真、架空のサンプルPDFを使った実アプリ画面を `public/` で管理します。
- 写真は見た目の画素を変えず、公開に不要なXMPメタデータだけを除去しています。
- 写真は GPL の対象外です。再利用条件は [素材のライセンス一覧](ASSET-LICENSES.md) に記載します。
- 文書のアップロード、アカウント作成、アクセス解析スクリプトは設けません。
- CloudflareによるWeb Analyticsビーコンの自動挿入を避けるため、`public/_headers`でHTMLの`/`と`/privacy/`へ`Cache-Control: no-transform`を指定します。公開後は実際のHTMLとブラウザーの外部リクエストを確認します。
- Cloudflare Workers Static AssetsのWorker名は `lumastudiopdf-official` です。既存の動画編集サイト `lumastudio-official` には触れません。

```sh
npm ci --prefix website
npm run dev --prefix website
npm run deploy:check --prefix website
```

`npm run deploy --prefix website` は `lumastudiopdf.altimix.jp` を公開更新します。実行前にアカウント、ドメイン、配布リンクを確認し、公開後はHTTPS表示・リンク・画像・モバイル画面を検証します。

アプリ配布物は公開 [GitHub Release v1.0.7](https://github.com/altimix/lumastudio-pdf/releases/tag/v1.0.7) のポータブルEXE・Mac ZIPに直接リンクします。LumaStudioシリーズの共通問い合わせ窓口は `https://altimix.co.jp/contact/` です。公開作業時は `VERIFY_DOWNLOADS=1` を設定してリンクを検査します。

Google Search Console の `https://lumastudiopdf.altimix.jp/` URLプレフィックス用確認タグは `public/index.html` の `<head>` に置き、所有権を維持するため公開後も残します。`sitemap.xml` にはトップ・使い方・データの扱いの正規URLを載せ、`robots.txt` から参照します。検索への掲載や順位はGoogleの判断で決まるため、Search Consoleの実際の検査結果を確認します。

## 学校向けの紹介と画面例

授業プリントや校務の書類に文字・チェック・手書きを加える「PDF追記ソフト」として紹介します。競合との比較や導入実績の推測はせず、元の本文の書き換え・OCRの対象外、AIの外部送信、同じ端末での再編集条件を明記します。

学校向けの画面例は、electron-builderが生成する展開済みパッケージを使って再撮影できます。スクリプトは起動したアプリがv1.0.7であることを確認します。アプリのバージョンが1.0.7のこのソースから、WindowsまたはMacで次を実行します。

```sh
npm ci
npm run package:dir
node website/capture-school.mjs
```

スクリプトの第1引数は **electron-builderの出力ルート** です。省略時はリポジトリ直下の `release/` を使います。出力ルート内には、実行するOS・CPUに対応する次の配置が必要です。

- Windows: `win-unpacked/LumaStudio PDF.exe`
- Apple Silicon Mac: `mac-arm64/LumaStudio PDF.app/Contents/MacOS/LumaStudio PDF`
- Intel Mac: `mac/LumaStudio PDF.app/Contents/MacOS/LumaStudio PDF`

出力先を変えた場合の例は `node website/capture-school.mjs /path/to/electron-builder-output` です。公開Windows版のポータブルEXEや、実行ファイル・`.app` 自体のパスは引数に指定できません。上のビルド手順で作成した出力ルートを指定してください。

架空のプリントをその場で生成し、実際のUIで文字・チェック・蛍光ペンを配置して保存した画面を撮影します。利用者のデータとは別の一時領域と受信箱を使い、AIは呼びません。生成画像以外の見本文書や一時アプリデータは残しません。
