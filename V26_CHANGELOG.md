# V26 / 3.2.7

## 緊急修正
- 保留 V25 的 R8 minify 與 resource shrinking，不回退最佳化。
- 新增 expo-sqlite / Expo Modules Record 的 R8 keep 規則，避免 `NativeDatabase.constructor` 將 JS options map 轉成 `OpenDatabaseOptions` 時失敗。
- 不變更 SQLite 資料庫名稱、schema、migration、GPS、運動流程、台語語音與 UI。

## 驗證重點
1. Release APK 必須仍為 minified + resource shrink。
2. 安裝後按「開始健行」不得再出現 `NativeDatabase.constructor` / `OpenDatabaseOptions` cast error。
3. 若仍失敗，再查 expo-sqlite / expo-modules-core 版本與初始化，不先重寫資料庫。
