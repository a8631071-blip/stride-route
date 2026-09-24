# 步跡 V25｜3.2.6

基底：V24 3.2.5／versionCode 20。V25：3.2.6／versionCode 21。

## 本版唯一功能範圍：Android Release 最佳化

- 啟用 R8 minify / obfuscation。
- 啟用 unused resource shrinking。
- 使用 `proguard-android-optimize.txt` 作為 release 最佳化基線。
- 保留 V24 既有 Reanimated / TurboModule keep 規則，不在本版縮減 keep 範圍。
- `expo-build-properties` 寫入 R8 設定，確保 `expo prebuild --clean` 後仍有效。
- build script 在 prebuild 後強制檢查 R8 / shrink / optimized ProGuard 是否真正落地。
- build script 保存 R8 mapping 輸出，供 Play Console crash deobfuscation 使用。
- 修正 V24 曾出現的 Gradle `BUILD SUCCESSFUL` 後 exit code 假失敗：若同次建置已產生新的 APK/AAB，改進入完整版本／簽章驗證，不自動重跑 Gradle。

## 明確未修改

- UI / 導航
- GPS / 距離 / 配速演算法
- 計步 / 熱量計算
- 台語播報 / RAW199 / 鼓勵語
- SQLite / GPX / Health Connect
- Android 15 edge-to-edge 警告
- Android 16 大螢幕／方向限制警告
- AGP 版本

## 風險

R8 只會影響 release 版本，因此正式上架前必須用 V25 release APK 實機測試：啟動、地圖、GPS、背景／鎖屏、語音、SQLite、GPX、Health Connect、版本更新。
