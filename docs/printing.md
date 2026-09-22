# 印刷から LumaStudio PDF に取り込む

MVP は Windows / macOS 共通の Electron アプリとして、PDF を開く・編集済み PDF を保存する・OS の印刷ダイアログで印刷する機能を実装しています。印刷元アプリから編集画面への連携は OS ごとに異なります。

| 機能 | Windows | macOS |
| --- | --- | --- |
| 編集済み PDF の保存 | ネイティブ保存ダイアログ | ネイティブ保存ダイアログ |
| 編集済み PDF の印刷 | OS の印刷ダイアログ | OS の印刷ダイアログ |
| 他アプリの印刷から取り込む | 任意導入の `LumaStudio PDF` プリンター、または PDF を受信箱に保存 | 印刷ダイアログの `PDF > LumaStudio PDF`、または PDF を受信箱に保存 |
| 自作の仮想プリンタードライバー | 未実装。既存 Microsoft ドライバーを利用 | 未実装。macOS PDF Service を利用 |

## Windows の任意セットアップ

`scripts/setup-printer.ps1` は、インストール済みの **Microsoft Print To PDF** ドライバーを再利用し、`LumaStudio PDF` というプリンターを追加します。ファイル名を指定した Local Port を使い、通常は `ドキュメント\LumaStudio PDF\Print Inbox\incoming.pdf` に出力します。

このスクリプトはアプリ起動時に実行されません。内容を確認したうえで、管理者 PowerShell で明示的に実行します。

```powershell
# 変更内容だけを確認
.\scripts\setup-printer.ps1 -WhatIf

# 任意導入。管理者権限が必要
.\scripts\setup-printer.ps1
```

別の管理者アカウントで実行する場合は、利用者のアプリ画面で表示される受信箱の絶対パスを `-InboxPath` で指定してください。ドキュメントフォルダーが OneDrive 等へ移動されている場合も、アプリが表示するパスと一致させます。

```powershell
.\scripts\setup-printer.ps1 -InboxPath 'C:\Users\your-name\Documents\LumaStudio PDF\Print Inbox'
```

追加後は LumaStudio PDF を起動し、Word 等で印刷先を **LumaStudio PDF** にします。ファイルサイズと更新日時が安定し、PDF の末尾を確認できた後に編集画面へ取り込みます。通常は数秒かかります。保存が終わるまで書きかけの PDF は読み込みません。

**MVP の固定ファイル方式は一度に 1 件だけを扱います。** 次の印刷は `incoming.pdf` を上書きします。前の文書が編集画面に表示されるまで待ち、編集後の PDF は別名で保存してください。アプリを閉じた状態で複数件印刷すると、受信箱には最後の 1 件のみ残ります。商用品質の独立ジョブ受信・アプリ自動起動・複数ユーザー同時利用は今後の実装です。

スクリプトはドライバーをダウンロードせず、既定プリンターを変更せず、既存プリンターを削除しません。同名で同設定なら何も変更しません。同名で異なる設定なら停止します。Microsoft Print To PDF がない場合は Windows の「Windows の機能」で追加してください。端末のポリシーやドライバーによって固定ポート出力が使えない場合は、標準の **Microsoft Print To PDF** で受信箱へ別名保存する方法を使えます。

## macOS の PDF メニュー連携

ビルドした `LumaStudio PDF.app` を `/Applications` へ配置した後、通常のユーザーで次を実行します。`sudo` は使いません。

```bash
bash scripts/install-macos-pdf-service.sh "/Applications/LumaStudio PDF.app"
```

現在のユーザーの `~/Library/PDF Services/` に、インストール済みアプリへのリンクを作成します。その後、他のアプリで **ファイル → プリント → PDF → LumaStudio PDF** を選択します。アプリは macOS の `open-file` イベントで受け取った PDF を編集画面へ渡します。プリンター一覧へドライバーを追加する方式ではありません。

同じリンクが存在すれば変更せず、別のファイルや異なるリンクが存在すれば停止します。アプリの署名・公証とインストーラー配布は別途必要です。未署名の開発版は macOS のセキュリティ設定により起動が止まる場合があります。

メニューに出ない場合は、印刷元アプリを開き直してください。代替として、印刷ダイアログの **PDF → PDF として保存** で受信箱へ保存できます。Automator の「プリントプラグイン」で「Finder 項目を開く」の使用アプリを LumaStudio PDF にする構成も選べます。

## 受信箱・保存・印刷の仕様

- 受信箱はアプリの「印刷受信箱を開く」から確認できます。起動時には受信箱にある PDF も読み込みます。アプリは受信元ファイルを削除しません。
- PDF 内容のハッシュで同一ファイルの重複受信を抑止します。アプリが受信箱へ直接保存したファイルも再取り込みを抑止します。
- 編集画面での取り込みは 50 MB 以下の PDF に対応します。受信待ちは最大 10 件、合計 160 MB です。超えた場合もファイルを保持し、手動で開けるようにします。
- 印刷は、文字や印鑑を反映した PDF を専用の sandbox 画面で約 150 dpi の画像に描画し、OS の印刷ダイアログへ送ります。元の PDF の保存はこの印刷用画像を使わないため、保存自体で全ページを画像化することはありません。
- 画面側から Node.js やファイルパスへの任意アクセスは許可していません。PDF は専用 IPC で受け渡し、印刷用ファイルをディスクに残しません。
- MVP の印刷上限は 100 ページかつ画像の合計 1.6 億画素です。大きな文書は PDF 保存後に通常の PDF ビューアーで印刷してください。ページごとの CSS 用紙サイズを指定しますが、混在サイズとプリンタードライバー固有の拡大縮小は実機で確認が必要です。
- 印刷画面でのキャンセルは通常終了として扱います。OS が印刷ジョブを受け付けたことと、用紙が実際に出力されたことは別です。

## 検証範囲

OS のプリンター追加や PDF Service の登録は、この開発作業では実行していません。実際の仮想プリンター出力、物理プリンターでの印刷、macOS 実機の PDF メニュー連携は未検証です。Windows で JavaScript と PowerShell の構文検査、および `node --test electron/pdf-files.test.cjs` の 2 件のテストが成功しました。テストは PDF データ検査、受信箱の書き込み完了待機・重複抑止・自分の保存の再取り込み抑止・元ファイル保持を確認しています。UI / Electron の動作確認結果はプロジェクトの README と開発報告を参照してください。

参考にした公式資料:

- [Microsoft: ファイル名を Local Port に指定する印刷](https://learn.microsoft.com/en-us/troubleshoot/windows-server/printing/print-to-file-without-user-intervention)
- [Microsoft: Add-PrinterPort](https://learn.microsoft.com/en-us/powershell/module/printmanagement/add-printerport)
- [Apple: Mac で書類を PDF として保存](https://support.apple.com/guide/mac-help/save-a-document-as-a-pdf-on-mac-mchlp1531/mac)
- [Apple: Automator ワークフローの種類](https://support.apple.com/guide/automator/create-a-workflow-aut7cac58839/mac)
- [Apple Developer Technical Support: PDF Services フォルダー](https://developer.apple.com/forums/thread/813622)
- [Electron: webContents.print](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback)
- [Electron: セキュリティの推奨事項](https://www.electronjs.org/docs/latest/tutorial/security)
