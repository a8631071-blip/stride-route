# V29 / 3.3.0 / versionCode 25

基底：V28 / 3.2.9 / versionCode 24。

## 本版主軸：Android GPS 距離單一化

- Android 運動模式以 `StrideWorkoutRuntimeService` 作為唯一 GPS 判定與距離 authority。
- Native journal 每顆定位點新增 `accepted / rejectReason / distanceDeltaMeters / cumulativeDistanceMeters / derivedSpeedMps / elapsedRealtimeNanos / sequence`。
- JS 不再把 Android Native journal 重新丟進 `evaluateRoutePoint()` 計算第二套距離；SQLite 改為鏡像 Native 判決與 `distanceMeters / maxSpeedMps`。
- 5 分鐘播報、距離 milestone、即時畫面、最終紀錄共用 Native `distanceMeters`。
- Android 起點不再由 JS `getCurrentPositionAsync()` 先塞一顆；第一個正式 accepted point 由 Native Runtime 決定。
- Android 即時速度改讀 Native Runtime `currentSpeedMps`；非 Android 既有 Expo Location 路徑不改。

## GPS filter 清理

Android Native 移除先前沒有公開依據的動態漂移公式：

- 移除 `accuracy uncertainty × 0.2 / 0.3`。
- 移除 drift cap `8m / 10m`。
- 移除 `device speed > maxSpeed × 1.25` 的第二倍率。
- 移除 Native 內額外的 `minTimeMs` 判定，改用 `elapsedRealtimeNanos` 驗證定位順序與計算時間差。

保留可解釋的固定 recording-distance guard：

- walk：3m
- run：3m
- shopping：4m
- bike：4m

保留：

- Google Fused Location `PRIORITY_HIGH_ACCURACY`。
- target interval 5 秒 / min interval 3 秒 / provider min update distance 3m。
- accuracy 上限：walk 40m / run 35m / shopping 35m / bike 50m。
- 明顯不可能速度與裝置 speed outlier 排除。

`setWaitForAccurateLocation` 改為 `true`，新運動先等較可靠的第一個定位。

## Segment / replay / recovery

- Native `segmentIndex` 成為 Android route 的正式 segment；JS 不再覆寫 Native journal 的 segment。
- SQLite `track_points` 新增：`native_sequence`、`elapsed_realtime_nanos`、`distance_delta_meters`、`cumulative_distance_meters`、`derived_speed_mps`。
- `(workout_id, native_sequence)` 建立 partial unique index，避免 React 重啟或 journal replay 重複寫入。
- 升級中若 V28 已寫入同一顆 track point、但尚無 `native_sequence`，V29 replay 會把 Native metadata 補掛回既有 row，避免之後反覆重播同一 journal line。
- Native runtime 若遺失但 SQLite 仍有 active workout，重新啟動前建立 recovery segment，不把失聯前後位置直接連成假距離。
- Runtime 可由 SQLite `distance / maxSpeed / sequence` seed 恢復，避免意外重新啟動時歸零。

## GPS 診斷

Native snapshot 新增：

- currentSpeedMps
- lastAcceptedAt
- rejectedInvalid
- rejectedAccuracy
- rejectedTooClose
- rejectedSpeed
- rejectedTime

結束運動時寫入 `diagnostic_events` 的 `gps-v29` 摘要，方便後續比對 Pacer 或其他 App 時直接判斷差距來源。

## 明確未修改

- Package `com.app.strideroute`。
- Upload Key / 簽章。
- V26 R8 + expo-sqlite keep 修復。
- R8 / resource shrink 保持開啟。
- V27 鼓勵語策略。
- V28 台語結束語音資源與 resource keep。
- 全天計步、Health Connect、Widget、熱量公式、地圖供應商。
- 非 Android 既有 Expo Location GPS filter 行為。

## 靜態 QC

`V29_GPS_QC.json`：48 checks / 48 pass。

本沙盒無法下載 Gradle 8.14.3 distribution，因此沒有宣稱 Android release build 已完成；正式 Windows `BUILD_V29_PRIVATE.ps1` 會執行 pnpm、tsc、Expo prebuild、Gradle、APK/AAB 版本/簽章/resource 驗證。
