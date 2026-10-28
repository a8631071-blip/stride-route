# 步跡（Stride Route）— 公開原始碼 V30

此儲存庫對應步跡 **V30 / 3.3.1（Android versionCode 26）**。

## 功能
- Android GPS 步行、跑步、騎乘紀錄及日常計步
- 運動距離、時間、步數與歷史紀錄
- 健康資料、背景運動記錄、語音播報
- 台語播報組音程式：`lib/fitness/taigi-speech-composer.ts`、`modules/stride-tts/`

## 技術
React Native / Expo SDK 54 / TypeScript，含 Android Kotlin 原生模組。

## 重要說明
本公開來源**不包含私人簽章、PRIVATE 建置腳本、個人真人錄音 WAV、語音包與測試診斷資料**。完整台語播放需由專案持有者將原有音檔恢復至 `modules/stride-tts/android/src/main/res/raw/`；缺少語音素材時不代表台語引擎已完整可播放。

設定的正式 App 版本請以 `app.config.ts` 為準。Android 原生目錄可能由 Expo prebuild 重新生成，請勿直接拿舊的 `android/app/build.gradle` 版本作為正式發布依據。

## Google Play
https://play.google.com/store/apps/details?id=com.app.strideroute

此處僅維護公開程式碼，不包含可直接發布至商店的正式簽章或私人建置材料。
