import { Platform } from "react-native";
import * as Speech from "expo-speech";

import { findTtsEngineForLanguage, hasPackagedTaigiVoice, installSystemTtsData, openSystemTtsSettings, playPackagedTaigiTokens, speakNativeTts } from "@/modules/stride-tts";
import { readFeatureSettings, type FeatureSettings, type VoiceLanguage } from "@/lib/feature-settings";
import { formatNumber, readLanguageSetting, resolveLanguage, translate, type ResolvedLocale } from "@/lib/i18n-core";
import { getElapsedSeconds } from "./math";
import { claimWorkoutVoiceMilestone, clearWorkoutVoiceMilestone, logDiagnosticEvent, releaseWorkoutVoiceMilestone, type WorkoutVoiceMilestoneKind } from "./storage";
import { distanceTokens, endSummaryTokens, integerTokens, progressDistanceTokens, progressTimeTokens, stateTokens } from "./taigi-speech-composer";
import type { WorkoutSession, WorkoutType } from "./types";

type SpeechLocale = ResolvedLocale | "nan-TW";
type EngineInfo = { enginePackage: string | null; engineLabel: string | null };
let voiceQueue: Promise<void> = Promise.resolve();
const engineCache = new Map<SpeechLocale, EngineInfo>();
const taigiProgressEncouragements = [
  "enc_great","enc_amazing","enc_awesome","enc_good","enc_not_bad","enc_very_good",
  "enc_can","enc_you_can","enc_you_can_do_it","enc_go","enc_go_again","enc_keep_going",
  "enc_try_more","enc_try_little_more","enc_continue","enc_keep_it","enc_hold","enc_hold_little",
  "enc_slow","enc_steady","enc_little_more","enc_tiny_more","enc_almost","enc_nearly",
  "enc_small_gap","enc_very_possible","enc_progress","enc_today_good","enc_nice_work","enc_keep",
] as const;
let lastTaigiProgressEncouragement: string | null = null;
function nextTaigiProgressEncouragement() {
  const choices = taigiProgressEncouragements.filter((key) => key !== lastTaigiProgressEncouragement);
  const key = choices[Math.floor(Math.random() * choices.length)] ?? taigiProgressEncouragements[0];
  lastTaigiProgressEncouragement = key;
  return key;
}

function ttsLanguage(locale: SpeechLocale) {
  if (locale === "zh-TW") return "zh-TW";
  if (locale === "nan-TW") return "nan-TW";
  if (locale === "ja") return "ja-JP";
  if (locale === "th") return "th-TH";
  if (locale === "ko") return "ko-KR";
  return "en-US";
}

export async function resolveVoiceLanguage(language: VoiceLanguage): Promise<SpeechLocale> {
  if (language === "follow-interface") return resolveLanguage(await readLanguageSetting());
  return language;
}

async function resolveEngine(locale: SpeechLocale): Promise<EngineInfo | null> {
  const cached = engineCache.get(locale);
  if (cached) return cached;
  if (Platform.OS !== "android") {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const tag = ttsLanguage(locale).toLowerCase();
      const base = tag.split("-")[0];
      const candidate = voices.find((voice) => {
        const language = (voice.language ?? "").toLowerCase().replace(/_/g, "-");
        if (locale === "nan-TW") return language === "nan" || language.startsWith("nan-") || /taiwanese|taigi|hokkien|min[ -]?nan|台語|閩南/i.test(voice.name ?? "");
        return language === tag || language.startsWith(`${base}-`) || language === base;
      });
      return candidate ? { enginePackage: null, engineLabel: candidate.name ?? null } : null;
    } catch { return null; }
  }
  const match = await findTtsEngineForLanguage(ttsLanguage(locale)).catch(() => null);
  if (!match?.available) return null;
  const info = { enginePackage: match.enginePackage, engineLabel: match.engineLabel };
  engineCache.set(locale, info);
  return info;
}

export function clearVoiceEngineCache() { engineCache.clear(); }

export async function isVoiceLanguageAvailable(language: VoiceLanguage) {
  const locale = await resolveVoiceLanguage(language);
  if (locale === "nan-TW" && Platform.OS === "android") return hasPackagedTaigiVoice().catch(() => false);
  return Boolean(await resolveEngine(locale));
}

export async function installVoiceLanguage(language: VoiceLanguage) {
  clearVoiceEngineCache();
  const locale = await resolveVoiceLanguage(language);
  if (locale === "nan-TW") {
    if (Platform.OS === "android") return hasPackagedTaigiVoice().catch(() => false);
    return false;
  }
  const opened = await installSystemTtsData().catch(() => false);
  return opened || openSystemTtsSettings().catch(() => false);
}

export async function openVoiceTtsSettings() {
  clearVoiceEngineCache();
  return openSystemTtsSettings().catch(() => false);
}

async function speak(text: string, locale: SpeechLocale) {
  const engine = await resolveEngine(locale);
  if (!engine) return false;
  if (Platform.OS === "android") {
    const ok = await speakNativeTts(text, ttsLanguage(locale), engine.enginePackage).catch(() => false);
    if (!ok) engineCache.delete(locale);
    return ok;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(ok);
    };
    try {
      Speech.speak(text, { language: ttsLanguage(locale), rate: 0.95, pitch: 1, onDone: () => finish(true), onStopped: () => finish(false), onError: () => finish(false) });
      timeout = setTimeout(() => finish(false), 20_000);
    } catch { finish(false); }
  });
}

function workoutLabel(type: WorkoutType, locale: SpeechLocale) {
  if (locale === "nan-TW") return type === "walk" ? "健行" : type === "run" ? "跑步" : type === "shopping" ? "逛街" : "騎車";
  return translate(`workout.${type}`, {}, locale);
}

function speechDistance(distanceMeters: number, locale: SpeechLocale) {
  if (distanceMeters < 1_000) {
    const value = locale === "nan-TW" ? Math.round(Math.max(0, distanceMeters)).toString() : formatNumber(Math.round(Math.max(0, distanceMeters)), locale);
    if (locale === "zh-TW" || locale === "nan-TW") return `${value} 公尺`;
    if (locale === "ja") return `${value}メートル`;
    if (locale === "th") return `${value} เมตร`;
    if (locale === "ko") return `${value}미터`;
    return `${value} meters`;
  }
  const km = distanceMeters / 1_000;
  const numberLocale = locale === "nan-TW" ? "zh-TW" : locale === "zh-TW" ? "zh-TW" : locale === "ja" ? "ja-JP" : locale === "th" ? "th-TH" : locale === "ko" ? "ko-KR" : "en-US";
  const formatted = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }).format(km);
  if (locale === "zh-TW" || locale === "nan-TW") return `${formatted} 公里`;
  if (locale === "ja") return `${formatted}キロメートル`;
  if (locale === "th") return `${formatted} กิโลเมตร`;
  if (locale === "ko") return `${formatted}킬로미터`;
  return `${formatted} kilometers`;
}

function speechPace(distanceMeters: number, elapsedSeconds: number, locale: SpeechLocale) {
  if (distanceMeters < 30 || elapsedSeconds < 1) return locale === "en" ? "not available" : "—";
  const secondsPerKilometer = Math.round((elapsedSeconds / distanceMeters) * 1_000);
  const minutes = Math.floor(secondsPerKilometer / 60);
  const seconds = secondsPerKilometer % 60;
  if (locale === "zh-TW") return `每公里 ${minutes} 分 ${seconds} 秒`;
  if (locale === "nan-TW") return `一公里 ${minutes} 分 ${seconds} 秒`;
  if (locale === "ja") return `1キロ ${minutes}分${seconds}秒`;
  if (locale === "th") return `${minutes} นาที ${seconds} วินาทีต่อกิโลเมตร`;
  if (locale === "ko") return `킬로미터당 ${minutes}분 ${seconds}초`;
  return `${minutes} minutes ${seconds} seconds per kilometer`;
}

function speechSpeed(distanceMeters: number, elapsedSeconds: number, locale: SpeechLocale) {
  const value = distanceMeters < 10 || elapsedSeconds < 1 ? 0 : (distanceMeters / elapsedSeconds) * 3.6;
  const numberLocale = locale === "nan-TW" ? "zh-TW" : locale === "zh-TW" ? "zh-TW" : locale === "ja" ? "ja-JP" : locale === "th" ? "th-TH" : locale === "ko" ? "ko-KR" : "en-US";
  const formatted = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value);
  if (locale === "zh-TW") return `每小時 ${formatted} 公里`;
  if (locale === "nan-TW") return `一點鐘 ${formatted} 公里`;
  if (locale === "ja") return `時速 ${formatted} キロメートル`;
  if (locale === "th") return `${formatted} กิโลเมตรต่อชั่วโมง`;
  if (locale === "ko") return `시속 ${formatted}킬로미터`;
  return `${formatted} kilometers per hour`;
}

function stateSpeech(type: WorkoutType, state: "start" | "pause" | "resume" | "end", locale: SpeechLocale) {
  if (locale === "nan-TW") {
    if (state === "start") return `開始${workoutLabel(type, locale)}`;
    if (state === "pause") return "運動暫停";
    if (state === "resume") return "繼續運動";
    return "運動結束";
  }
  const key = state === "start" ? "speech.start" : state === "pause" ? "speech.pause" : state === "resume" ? "speech.resume" : "speech.end";
  return translate(key, { mode: workoutLabel(type, locale) }, locale);
}

async function announcementLocales(settings: FeatureSettings) {
  const primary = await resolveVoiceLanguage(settings.voiceLanguage);
  if (settings.voiceMode !== "bilingual") return [primary];
  const secondary = await resolveVoiceLanguage(settings.secondaryVoiceLanguage);
  return secondary === primary ? [primary] : [primary, secondary];
}

async function speakConfigured(text: string, locale: SpeechLocale, taigiTokens: string[] | null = null) {
  if (locale === "nan-TW" && Platform.OS === "android") {
    if (!taigiTokens?.length) return false;
    return playPackagedTaigiTokens(taigiTokens).catch(() => false);
  }
  return speak(text, locale);
}

async function speakAll(textForLocale: (locale: SpeechLocale) => string, settings: FeatureSettings, taigiTokensForLocale?: (locale: SpeechLocale) => string[] | null) {
  const locales = await announcementLocales(settings);
  let anyOk = false;
  for (const locale of locales) {
    const ok = await speakConfigured(textForLocale(locale), locale, taigiTokensForLocale?.(locale) ?? null);
    anyOk = anyOk || ok;
    if (!ok) await logDiagnosticEvent("voice-language", `${ttsLanguage(locale)} unavailable or failed`).catch(() => undefined);
  }
  return anyOk;
}

export async function buildNativeWorkoutVoiceConfig() {
  const settings = await readFeatureSettings();
  const locales = await announcementLocales(settings);
  const resolveRuntime = async (locale: SpeechLocale) => {
    if (locale === "nan-TW") return { locale, enginePackage: "" };
    const engine = await resolveEngine(locale);
    return { locale, enginePackage: engine?.enginePackage ?? "" };
  };
  const primary = await resolveRuntime(locales[0]);
  const secondary = locales[1]
    ? await resolveRuntime(locales[1])
    : { locale: "", enginePackage: "" };
  return {
    voiceEnabled: settings.voiceAnnouncementsEnabled,
    cueBasis: settings.voiceCueBasis,
    intervalMinutes: settings.voiceAnnouncementIntervalMinutes,
    intervalMeters: settings.voiceDistanceIntervalMeters,
    voiceMode: settings.voiceMode,
    primaryLocale: primary.locale,
    primaryEngine: primary.enginePackage,
    secondaryLocale: secondary.locale,
    secondaryEngine: secondary.enginePackage,
  };
}

export async function announceWorkoutState(type: WorkoutType, state: "start" | "pause" | "resume" | "end", session?: WorkoutSession | null) {
  const settings = await readFeatureSettings();
  if (!settings.voiceAnnouncementsEnabled) return;
  voiceQueue = voiceQueue.then(async () => {
    await speakAll(
      (locale) => stateSpeech(type, state, locale),
      settings,
      (locale) => {
        if (locale !== "nan-TW") return null;
        if (state === "end" && session) return ["state_end","pause_medium",...endSummaryTokens({type,minutes:Math.max(0,Math.round(getElapsedSeconds(session)/60)),distanceMeters:session.distanceMeters,steps:session.steps,caloriesKcal:session.estimatedCaloriesKcal,encouragementKey:"enc_hard_work",closingKey:"enc_finish"})];
        return stateTokens(type, state);
      },
    );
  }).catch(() => undefined);
  await voiceQueue;
}

function progressText(session: WorkoutSession, elapsedSeconds: number, dueMinutes: number, distanceForCue: number, locale: SpeechLocale, compact: boolean) {
  const distance = speechDistance(distanceForCue, locale);
  const minutes = Math.max(0, dueMinutes);
  if (compact) {
    if (locale === "nan-TW") return `運動時間 ${minutes} 分鐘，距離 ${distance}`;
    return translate("speech.progressCore", { minutes, distance }, locale);
  }
  if (session.type === "bike") {
    const speed = speechSpeed(session.distanceMeters, elapsedSeconds, locale);
    return locale === "nan-TW"
      ? `運動時間 ${minutes} 分鐘，距離 ${distance}，平均速度 ${speed}`
      : translate("speech.progressBike", { minutes, distance, speed }, locale);
  }
  if (session.type === "shopping") {
    return locale === "nan-TW"
      ? `逛街時間 ${minutes} 分鐘，路程 ${distance}`
      : translate("speech.progressCore", { minutes, distance }, locale);
  }
  const pace = speechPace(session.distanceMeters, elapsedSeconds, locale);
  if (locale === "nan-TW") return `運動時間 ${minutes} 分鐘，距離 ${distance}，平均配速 ${pace}`;
  // Periodic progress intentionally omits step count in V24.
  if (locale === "zh-TW") return `運動時間 ${minutes} 分鐘，距離 ${distance}，平均配速 ${pace}`;
  if (locale === "ja") return `運動時間 ${minutes} 分、距離 ${distance}、平均ペース ${pace}`;
  if (locale === "th") return `เวลาออกกำลังกาย ${minutes} นาที ระยะทาง ${distance} เพซเฉลี่ย ${pace}`;
  if (locale === "ko") return `운동 시간 ${minutes}분, 거리 ${distance}, 평균 페이스 ${pace}`;
  return `Workout time ${minutes} minutes, distance ${distance}, average pace ${pace}`;
}

function taigiProgressTokens(session: WorkoutSession, elapsedSeconds: number, announcedMinutes: number, announcedDistance: number, compact: boolean) {
  const tokens: string[] = [...progressTimeTokens(Math.max(0, announcedMinutes)), "pause_medium", ...progressDistanceTokens(session.type, announcedDistance)];
  if (!compact && session.type === "bike") {
    const speedKmh = session.distanceMeters < 10 || elapsedSeconds < 1 ? 0 : (session.distanceMeters / elapsedSeconds) * 3.6;
    tokens.push("pause_medium","phrase_average_speed","phrase_per_hour",...distanceTokens(speedKmh * 1000));
  } else if (!compact && session.type !== "shopping" && session.distanceMeters >= 30 && elapsedSeconds >= 1) {
    const spk=Math.round((elapsedSeconds/session.distanceMeters)*1000);
    tokens.push("pause_medium","phrase_average_pace",...integerTokens(Math.floor(spk/60),true),"unit_minute",...integerTokens(spk%60,true),"unit_second");
  }
  tokens.push("pause_medium", nextTaigiProgressEncouragement());
  return tokens;
}

async function maybeAnnounceInternal(session: WorkoutSession) {
  if (session.status !== "active") return;
  const settings = await readFeatureSettings();
  if (!settings.voiceAnnouncementsEnabled) return;

  const elapsedSeconds = getElapsedSeconds(session);
  let kind: WorkoutVoiceMilestoneKind;
  let milestone: number;
  let announcedMinutes: number;
  let announcedDistance: number;

  if (settings.voiceCueBasis === "distance") {
    kind = "distance";
    const intervalMeters = settings.voiceDistanceIntervalMeters;
    milestone = Math.floor(session.distanceMeters / intervalMeters) * intervalMeters;
    if (milestone < intervalMeters) return;
    announcedDistance = milestone;
    announcedMinutes = Math.max(1, Math.floor(elapsedSeconds / 60));
  } else {
    kind = "time";
    const intervalMinutes = settings.voiceAnnouncementIntervalMinutes;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    milestone = Math.floor(elapsedMinutes / intervalMinutes) * intervalMinutes;
    if (milestone < intervalMinutes) return;
    announcedDistance = session.distanceMeters;
    announcedMinutes = milestone;
  }

  if (!await claimWorkoutVoiceMilestone(session.id, kind, milestone)) return;
  const compact = settings.voiceMode === "bilingual";
  const locales = await announcementLocales(settings);
  let anyOk = false;
  for (const locale of locales) {
    const ok = await speakConfigured(
      progressText(session, elapsedSeconds, announcedMinutes, announcedDistance, locale, compact),
      locale,
      locale === "nan-TW" ? taigiProgressTokens(session, elapsedSeconds, announcedMinutes, announcedDistance, compact) : null,
    );
    anyOk = anyOk || ok;
    if (!ok) {
      await logDiagnosticEvent("voice-announcement", `${kind} milestone ${milestone} failed for ${ttsLanguage(locale)}`).catch(() => undefined);
    }
  }
  // If at least one configured language was heard, keep the milestone claimed.
  // Otherwise a missing secondary language would cause the successful primary language
  // to repeat on every foreground/background callback. Retry only when nothing played.
  if (!anyOk) await releaseWorkoutVoiceMilestone(session.id, kind, milestone).catch(() => undefined);
}

export async function maybeAnnounceWorkoutProgress(session: WorkoutSession) {
  if (Platform.OS === "android") return;
  voiceQueue = voiceQueue.then(() => maybeAnnounceInternal(session)).catch(() => undefined);
  await voiceQueue;
}

export async function clearWorkoutVoiceProgress(workoutId: string) {
  await clearWorkoutVoiceMilestone(workoutId).catch(() => undefined);
}
