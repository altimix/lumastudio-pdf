# 開発・レビュー・リリース

Issue に目的と完了条件を記録してから、変更ごとにブランチと Pull Request を作ります。Windows・macOS の CI と `@codex review` の両方を確認して `main` に取り込みます。テストが通ることと、コードを読んで不具合を探すことを組み合わせます。

## 通常の変更

1. Issue に利用者の目的、完了条件、対象範囲、確認方法を書く。`main` を最新にし、`feat/1-release-readiness` のように Issue 番号と目的がわかる作業ブランチを作る。
2. 変更と必要なテストを実装し、`npm test`、`npm run release:check`、`npm run build`、`npm run test:e2e` を実行する。ローカルの E2E は別ターミナルで `npm run dev` を起動する。
3. Pull Request に「何ができるようになるか」「検証結果」「確認が残る範囲」を記載し、関連 Issue を `Refs #1` や `Closes #1` で紐付ける。リリースまでが完了条件の場合は配布検証後に Issue を閉じる。
4. PR コメントで `@codex review` を依頼し、Windows・macOS の CI とレビューの完了を待つ。
5. 指摘された不具合を修正し、最新のコミットで CI が成功し、レビューの指摘が解消したことを確認する。
6. Squash merge し、ローカルの `main` を同期する。ビルド済みファイルをコミットしない。

CI の定義は `.github/workflows/build.yml` です。単体テスト、型検査、本番ビルド、ブラウザー操作、両 OS のパッケージ作成、ホストの CPU に対応した配布アプリの起動とサンプル PDF 表示を確認します。Mac では作成した両アーキテクチャの `.app` を `codesign --verify --deep --strict` でも検査します。実プリンター出力・他アプリの印刷メニュー・利用者の証明書の信頼性は CI の対象外です。

electron-builder は PR ではアドホック署名も省略するため、Mac のパッケージ作成ステップだけ `CSC_FOR_PULL_REQUEST=true` と明示した `mac.identity=-` を使います。証明書の自動検索を無効にし、署名用秘密情報は渡しません。発行元の証明書を使うための設定ではなく、OS の保護設定も変更しません。

Mac の配布方式は [LumaStudioのMac版](https://github.com/altimix/LumaStudio/blob/main/README-Mac.txt) を参考にし、初回のアプリ個別許可は [Apple公式の手順](https://support.apple.com/ja-jp/guide/mac-help/mh40616/mac) に沿って `README-Mac.txt` で説明します。PDF版は `hardenedRuntime: true` と必要なElectronのentitlementsを維持します。`scripts/release-mac-check.mjs` は独自の短い検証スクリプトで、各配布ZIPを一時フォルダーへ展開し、同梱案内・リソース署名・bundle全体の整合性を確認します。検証専用コピーのリソースへ追記して検証が失敗することも確認し、元のZIP・利用者のアプリ・隔離属性は変更しません。初回のGatekeeper許可画面の実機確認とは区別します。

## 試用版リリース

1. `package.json` と `package-lock.json` のバージョンを合わせ、`docs/releases/v<version>.md` を作成して、通常の PR の手順でマージする。
2. マージ後の `main` の CI 成功を確認し、そのコミットに `v<version>` タグを付けて push する。例: バージョン `0.1.0` は `v0.1.0`。
3. `.github/workflows/release.yml` が、タグとバージョンの一致、両 OS の全テスト、配布物の起動を再確認する。
4. Windows のインストーラー・ポータブル版、Mac の Intel・Apple Silicon それぞれの DMG・ZIP、SHA-256 チェックサムが揃った場合のみ GitHub の **Pre-release** を作成する。
5. Release ページ、タグのコミット、6 種類の配布物、`README-Mac.txt` と `SHA256SUMS.txt` を確認し、Issue の完了条件と結果を更新して閉じる。チェックサムは案内ファイルも対象とする。既存リリースを無条件に上書きせず、修正版には新しいバージョンを使う。

リリースのビルドジョブは読み取り権限のみです。GitHub のリリース作成ジョブだけが `contents: write` を持ちます。リポジトリの可視性は変更しません。現在は発行元のコード署名・Apple の公証を持たない試用版として配布します。Mac のアドホック署名はアプリの構造を検証するためのもので、発行元の認証ではありません。

## 情報の取り扱い

- `.env`、API キー、利用者の PDF、印影、秘密鍵、P12/PFX、作業データを Git や配布物へ入れない。テストには架空のデータとテスト専用証明書を使う。
- PDF の原本は利用者が指定しない限り上書きしない。署名済み PDF は閲覧専用を維持し、署名を保持できない編集を通さない。
- AI は明示実行したときだけ文書と登録情報を送信する。通常の CI と E2E は実 API を呼ばない。
- パッケージ起動のテストには隔離したデータフォルダーを使う。`release-smoke.mjs` は起動前に主要な配布コードと現在のソースを照合し、受信箱の隔離に対応していない古いパッケージを起動しない。`LUMA_PRINT_INBOX` にテスト専用の空フォルダーの絶対パスを指定し、起動後もその受信箱を使用していることを確認する。テストから OS のプリンター設定やセキュリティ設定を変更しない。

アプリアイコンは `build/icon.svg` を元に `npm run release:icons` で生成できます。ユーザーの印影をブランド素材へ流用しません。
