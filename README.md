# 步跡（Stride Route）

「步跡」是一款免費、無廣告的 Android GPS 運動軌跡與日常計步 App，可用於步行、跑步與騎乘紀錄。

## 主要功能

- GPS 記錄步行、跑步與騎乘路線
- 顯示距離、時間、速度、配速與步數
- 日常計步器
- 運動歷史紀錄
- 背景運動路線記錄
- Android Health Connect 步數整合
- 運動語音播報與相關 Android 原生模組

## Google Play

https://play.google.com/store/apps/details?id=com.app.strideroute

## 開發環境

- React Native
- Expo SDK 54
- TypeScript
- Android minSdk 26 / targetSdk 36

## 專案結構

- `app/`：App 畫面與路由
- `components/`：共用介面元件
- `lib/`：功能邏輯、運動與計步相關程式
- `modules/stride-activity-recognition/`：活動辨識原生模組
- `modules/stride-tts/`：運動語音播報模組與語音資源
- `modules/stride-widget/`：Android Widget 原生模組
- `android/`：Android 原生專案與設定
- `plugins/`：Expo config plugins

## 公開版原始碼

此 Repository 為「步跡」公開版原始碼。公開內容已排除正式商店簽章檔、簽章密碼、私人憑證與私人建置資料；Google Play 正式版本使用的簽章資料不包含於本專案。

目前公開版對應 App 版本：**3.2.7**。

## 授權

目前本 Repository **尚未加入 LICENSE**。在正式授權條款加入前，公開可閱讀原始碼不代表已授權他人複製、修改、再散布或商業使用。

如需使用本專案內容，請先取得作者授權。
