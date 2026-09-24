# 步跡（Stride Route）

「步跡」是一款免費、無廣告的 Android GPS 運動軌跡與日常計步 App。可用於步行、跑步與騎乘，記錄 GPS 路線、距離、時間、速度、配速與步數；平常也可以直接當作日常計步器使用。

## 一般使用者

如果只是要使用 App，不需要下載或編譯這裡的原始碼，請直接從 Google Play 安裝正式版：

https://play.google.com/store/apps/details?id=com.app.strideroute

## 主要功能

- 步行、跑步、騎乘 GPS 運動路線記錄
- 距離、時間、速度與配速統計
- 日常步數記錄
- 運動歷史紀錄
- 背景運動路線記錄
- Android Health Connect 步數整合
- 語音運動播報
- 多語系介面與播報

## 技術架構

- React Native
- Expo SDK 54
- TypeScript
- Android minSdk 26 / targetSdk 36
- MapLibre
- Health Connect
- Android 原生 Kotlin 模組

## 原始碼結構

- `app/`：主要頁面與路由
- `components/`：共用介面元件
- `lib/`：運動紀錄、資料庫、語音、Health Connect、語系等核心邏輯
- `modules/`：步數、Widget、TTS 等 Android 原生整合
- `plugins/`：Expo Android 設定插件
- `android/`：Android 原生專案
- `assets/`：App 圖片與必要資源

## 公開版安全處理

此 Repository 為公開原始碼版本。正式商店簽章檔、keystore、簽章密碼、私人建置資料與不應公開的內部檔案均不包含在公開版本中。

因此，公開版不會提供正式 Google Play 商店簽章憑證；自行編譯時需使用自己的 Android 簽章設定。

## 開發

安裝相依套件後可使用 Expo / React Native 開發流程。Android 原生功能需要 Android 開發環境，部分功能（例如背景定位、Health Connect、Widget）應使用實機測試。

## 版本

目前公開整理基準：3.2.7。

## 授權

目前尚未加入開源授權條款。在 LICENSE 正式加入前，本 Repository 的公開內容僅供檢視與參考，不代表已授權再散布、修改後散布或商業使用。
