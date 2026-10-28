# V30 / 3.3.1 / versionCode 26

基底：V29 / 3.3.0 / versionCode 25。

## 本版主軸：GPS filter Shadow Mode

V30 **不直接改正式里程演算法**。V29 的 Android Native 單一 GPS / distance authority 完整保留；正式畫面、語音、里程 milestone、歷史紀錄、配速與 GPX 仍使用既有 `distanceMeters`。

本版在同一批 Native accepted GPS 點後方，平行計算兩套不影響正式里程的 shadow 結果：

1. `accuracy-weighted`：最近 5 個 accepted 點，以 `1 / accuracy²` 權重形成平滑位置。
2. `Kalman`：本地公尺座標 2D constant-velocity Kalman；GPS `accuracy²` 直接作為 measurement variance，時間差使用 `elapsedRealtimeNanos`。

兩套 shadow 都只用於診斷比較，不會回寫或覆蓋正式 `distanceMeters`。

## 診斷資料

Native journal / SQLite `track_points` 新增：

- `shadow_weighted_latitude / longitude`
- `shadow_weighted_delta_meters / cumulative_meters`
- `shadow_kalman_latitude / longitude`
- `shadow_kalman_delta_meters / cumulative_meters`
- `shadow_filter_reset`

`workouts` 新增 nullable 摘要欄位：

- `gps_weighted_shadow_meters`
- `gps_kalman_shadow_meters`

Native snapshot 新增：

- `shadowWeightedDistanceMeters`
- `shadowKalmanDistanceMeters`
- `shadowFilterResets`

結束運動的診斷事件 scope 改為 `gps-v30`，同時保存正式距離與兩套 shadow 總距離。

## CSV 比較

既有「匯出 CSV」新增欄位：

- `gps_weighted_shadow_meters`
- `gps_kalman_shadow_meters`
- `gps_weighted_vs_official_pct`
- `gps_kalman_vs_official_pct`

因此正常走完一趟後，不需要改 UI，即可直接比較：正式 V29 距離 vs weighted shadow vs Kalman shadow。

## Segment / runtime 行為

- 新運動：shadow filter 從第一顆正式 accepted point 初始化。
- pause / resume：shadow filter 新 segment 重新初始化，不跨暫停點連距離。
- Native runtime 若被系統重建：shadow filter 重新初始化，累積 shadow 總距離由 SQLite seed 恢復，並記錄 `shadowFilterResets`；避免把 runtime 中斷前後硬連成假距離。

## 明確未修改

- V29 正式 `distanceMeters += evaluation.distance` 路徑。
- walk/run/shopping/bike 既有 accuracy / speed / recording-distance guard。
- Fused Location High Accuracy / 5s target / 3s min / provider 3m。
- Native/JS 單一 authority 架構。
- pause/resume 正式 segment 規則。
- V26 SQLite/R8 修復。
- V27 鼓勵語。
- V28 台語結束語音與 resource keep。
- 熱量、步數、Health Connect、Widget、地圖供應商。
- Upload Key / package id。

## 驗收目的

V30 的目的不是證明某一種 filter 已經正確，而是用同一趟實際 GPS 資料取得三組可比數字，再決定 V31 是否讓某個 filtered path 接管正式距離。
