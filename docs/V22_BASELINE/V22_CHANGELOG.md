# V22 / 3.2.3 / versionCode 18

## 台語真人語音
- 使用 2026-09-05 RAW99 V2 全批重新後製。
- 字前額外保留 0 ms；字尾保留約 30 ms 自然餘音。
- 只做極短 2 ms fade-in / 3 ms fade-out 防 click，不增加停頓。
- Runtime 播放速度由 1.15x 回到 1.00x。
- 移除 blanket 10 ms crossfade；不再 runtime 二次裁 speech token。
- pause 改 35 / 70 / 110 ms。
- 開始語音：開始健行／開始跑步／開始逛街／開始騎車。
- 共用狀態：運動暫停／繼續運動／運動結束。
- 路程用語與 0.0X「空點空X」錄音沿用本批新真人錄音。
- 運動結束摘要加入「消耗＋數字＋大卡」；熱量單位使用真人「大卡」。

## 新增逛街模式
- 正式 WorkoutType: shopping。
- 適用逛街、夜市、菜市場、市集等走走停停情境。
- 不自動暫停；總時間從開始到手動暫停／結束持續計算。
- UI 主指標改為逛街時間，距離與步數為輔。
- GPS 使用獨立 stop-and-go profile；既有 walk/run/bike profile 不更動。
- 逛街進度播報不報平均配速，避免停留時間造成誤導。
