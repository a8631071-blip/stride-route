StrideRoute 台語離線語音 V23

架構：Context-first Hybrid

1. V22 的 99 組真人 token + 3 組 pause = 102 WAV 全部保留作完整 fallback。
2. V23 另加入 RAW50 V3 的 50 個完整數字語境 WAV。
3. V23 另加入 V6 CANDIDATE_03 / S1-e3 的 6 個完整句 WAV，已轉為 22050 Hz / mono / PCM16。
4. Runtime 命中完整語境時直接播放完整 WAV；沒有命中才回到 V22 token composer。
5. 手機端沒有 GPT-SoVITS 模型、沒有網路 AI inference；所有語音仍可完全離線。
6. Runtime 1.00x，不做 blanket crossfade，不再二次裁真人／AI完整句。
7. pause: 35 / 70 / 110 ms。
8. decimal_point 禁止；既有 decimal_0～decimal_9 fallback 規則保留。
9. 健行／逛街才可套用「已經走 X 公里」完整距離句；跑步／騎車保留原動詞。
10. V6 已知限制：數字 2 / jī 仍偏 LI 聽感；使用者決定 V23 先接受，之後再評估。

完整資產與來源請看 context_manifest_v23.json。
