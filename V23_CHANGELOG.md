# V23 / 3.2.4 / versionCode 19

## 台語播報：Context-first Hybrid

- V22 的 102 個真人 token 完整保留，作為所有動態數值的離線完整 fallback。
- 新增 RAW50 V3 的 50 個完整數字語境 WAV，避免已錄製語境仍被拆成 A+B+C。
- 新增 V6 `CANDIDATE_03 / S1-e3` 的 6 個完整句 WAV，統一轉為 22050 Hz / mono / PCM16。
- V23 不在手機端執行 GPT-SoVITS；AI 只用於事先生成完整句資產。
- 進度播報優先使用「完整時間／完整距離／完整速度語境」，沒有精確匹配才退回 V22 token composer。
- 健行／逛街才允許使用「已經走 X 公里」完整距離句；跑步／騎車保留各自動詞，不可誤套。
- 運動結束摘要可對已錄製的時間、步數、熱量使用完整語境，其他數值仍完整支援 fallback。
- `decimal_point` 仍禁止；V22 decimal_0～decimal_9 規則保留。
- 數字 1 的目前成果使用者已接受；數字 2 / jī 仍有偏 LI 的已知口音限制，本版先接受並凍結，不啟動第七輪訓練。

## 不變項目

- package 永久維持 `com.app.strideroute`。
- GPS filter、Native Foreground Runtime、背景 GPS、Health Connect、Widget、更新機制均未修改。
- UI 語言與播報語言仍分開；台語仍只提供語音，不新增台語介面。
- Upload Key 不變。
