import AsyncStorage from "@react-native-async-storage/async-storage";

export type VoiceIntervalMinutes = 5 | 10 | 15;
export type VoiceDistanceIntervalMeters = 500 | 1000 | 2000 | 5000;
export type VoiceLanguage = "follow-interface" | "zh-TW" | "en" | "ja" | "th" | "ko" | "nan-TW";
export type VoiceMode = "single" | "bilingual";
export type VoiceCueBasis = "time" | "distance";

export type FeatureSettings = {
  voiceAnnouncementsEnabled: boolean;
  voiceAnnouncementIntervalMinutes: VoiceIntervalMinutes;
  voiceDistanceIntervalMeters: VoiceDistanceIntervalMeters;
  voiceCueBasis: VoiceCueBasis;
  voiceMode: VoiceMode;
  voiceLanguage: VoiceLanguage;
  secondaryVoiceLanguage: VoiceLanguage;
  autoUpdateCheckEnabled: boolean;
};

const KEY = "stride-route.v10.feature-settings";
export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  voiceAnnouncementsEnabled: true,
  voiceAnnouncementIntervalMinutes: 5,
  voiceDistanceIntervalMeters: 1000,
  voiceCueBasis: "time",
  voiceMode: "single",
  voiceLanguage: "follow-interface",
  secondaryVoiceLanguage: "en",
  autoUpdateCheckEnabled: true,
};

const VOICE_LANGUAGES = new Set<VoiceLanguage>(["follow-interface", "zh-TW", "en", "ja", "th", "ko", "nan-TW"]);
const DISTANCE_INTERVALS = new Set<VoiceDistanceIntervalMeters>([500, 1000, 2000, 5000]);

export async function readFeatureSettings(): Promise<FeatureSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_FEATURE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FeatureSettings>;
    const interval = parsed.voiceAnnouncementIntervalMinutes;
    const distanceInterval = parsed.voiceDistanceIntervalMeters;
    const voiceLanguage = parsed.voiceLanguage && VOICE_LANGUAGES.has(parsed.voiceLanguage) ? parsed.voiceLanguage : "follow-interface";
    const secondaryVoiceLanguage = parsed.secondaryVoiceLanguage && VOICE_LANGUAGES.has(parsed.secondaryVoiceLanguage) ? parsed.secondaryVoiceLanguage : "en";
    return {
      voiceAnnouncementsEnabled: parsed.voiceAnnouncementsEnabled !== false,
      voiceAnnouncementIntervalMinutes: interval === 10 || interval === 15 ? interval : 5,
      voiceDistanceIntervalMeters: distanceInterval && DISTANCE_INTERVALS.has(distanceInterval) ? distanceInterval : 1000,
      voiceCueBasis: parsed.voiceCueBasis === "distance" ? "distance" : "time",
      voiceMode: parsed.voiceMode === "bilingual" ? "bilingual" : "single",
      voiceLanguage,
      secondaryVoiceLanguage,
      autoUpdateCheckEnabled: parsed.autoUpdateCheckEnabled !== false,
    };
  } catch {
    return DEFAULT_FEATURE_SETTINGS;
  }
}

export async function writeFeatureSettings(settings: FeatureSettings) {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
