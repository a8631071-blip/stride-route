# V28 / 3.2.9

基底：V27 / 3.2.8 / versionCode 23。

## 本版只修運動結束語音

- versionCode 提升為 24。
- 保留 V27 的 R8、resource shrink、SQLite 修復、台語數字／鼓勵、設定頁版面等全部既有內容。
- 新增 Android resource shrink `tools:keep`，明確保留 stride-tts 以 `Resources.getIdentifier()` 動態取得的整套台語 raw WAV。
- 原因：小數點前「控」在 Android Runtime Service 的 Kotlin 程式中有動態 token 字串，因此可能被 shrinker 保留；結束專用 `word_walked / word_ran / word_rode / word_today / word_total` 主要由 JS 動態組合，不能以「控能播」推論它們也一定存在於 release 成品。
- 台語結束播放拆為兩段：先獨立播放 `state_end`，再播放完整總結。第二段失敗不再連第一段一起無聲。
- 新增結束語音失敗診斷事件 `voice-end`。
- BUILD_V28_PRIVATE.ps1 在 release 建置後用 `aapt dump resources` 驗證結束語音必要 raw 資源確實存在，缺任一顆即拒絕交付 APK/AAB。

## 不變

- 不改 GPS、距離演算法、計步、SQLite schema、運動資料結構。
- 不改 5 分鐘播報邏輯與 V27 鼓勵排列。
- 不關閉 R8 或 resource shrink。
