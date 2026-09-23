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

アプリ配布物は公開 [GitHub Release v1.0.2](https://github.com/altimix/lumastudio-pdf/releases/tag/v1.0.2) のポータブルEXE・Mac ZIPに直接リンクします。LumaStudioシリーズの共通問い合わせ窓口は `https://altimix.co.jp/contact/` です。公開作業時は `VERIFY_DOWNLOADS=1` を設定してリンクを検査します。
