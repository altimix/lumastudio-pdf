# 同梱日本語フォント

文字の初期設定は Noto Sans JP・11 pt・黒（RGB 0, 0, 0）です。
Google Fonts で公開されている次の書体を、Fontsource の npm パッケージからアプリに同梱しています。
編集中や PDF 保存時に Google Fonts へ接続することはありません。

| 選択名 | 同梱パッケージ | バージョン | ライセンス |
| --- | --- | --- | --- |
| Noto Sans JP | `@fontsource-variable/noto-sans-jp` | 5.3.0 | SIL Open Font License 1.1 |
| Noto Serif JP | `@fontsource-variable/noto-serif-jp` | 5.3.0 | SIL Open Font License 1.1 |
| M PLUS 1 | `@fontsource-variable/m-plus-1` | 5.3.0 | SIL Open Font License 1.1 |
| BIZ UDGothic | `@fontsource/biz-udgothic` | 5.3.0 | SIL Open Font License 1.1 |

各パッケージの著作権表示とライセンス原文は、アプリの `dist/font-licenses/` に収録しています。
ソースコード上では `public/font-licenses/` にあります。フォントファイルに変更は加えていません。
太字は 700、標準は 400 を使います。斜体はブラウザーの合成斜体で、画面と保存 PDF に同じ描画処理を使います。

初めて書体を使うときに、その書体の日本語サブセットをすべて端末内で読み込みます。
これにより、IME で新しい漢字を入力しても、別の字体で測定された幅や高さが混ざりません。
文字は選んだ書体を使って描画した画像として PDF に保存するため、受け取る側のフォント環境にも依存しません。

v0.2.0 以前の編集用ファイルに保存された文字は、「従来のシステムフォント（互換）」のまま開きます。
この互換書体だけは端末の Yu Gothic / Hiragino / Meiryo を利用します。
別の端末でも揃えたい場合は、同梱書体に変更して編集用ファイルを保存してください。

配布方法: [Fontsource のセルフホスト手順](https://fontsource.org/docs/getting-started/install)
