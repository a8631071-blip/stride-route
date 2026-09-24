import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { checkForPlayUpdate, getCurrentAppVersion, openGooglePlayUpdatePage } from "@/lib/app-update";
import { DEFAULT_FEATURE_SETTINGS, readFeatureSettings, type FeatureSettings, type VoiceCueBasis, type VoiceDistanceIntervalMeters, type VoiceIntervalMinutes, type VoiceLanguage, type VoiceMode, writeFeatureSettings } from "@/lib/feature-settings";
import { useFitness } from "@/lib/fitness/fitness-provider";
import { openHealthConnectSettings } from "@/lib/fitness/health-connect";
import { clearVoiceEngineCache, installVoiceLanguage, isVoiceLanguageAvailable, openVoiceTtsSettings, resolveVoiceLanguage } from "@/lib/fitness/speech";
import { LANGUAGE_OPTIONS, useI18n, type AppLanguage } from "@/lib/i18n";

export default function SettingsScreen() {
  const { t, language, setLanguage, formatNumber } = useI18n();
  const permissionLabel = (state: string) => ({
    granted: t("settings.permissionGranted"), denied: t("settings.permissionDenied"), unavailable: t("settings.permissionUnavailable"), error: t("settings.permissionError"), available: t("settings.permissionAvailable"), unknown: t("settings.permissionUnknown"),
  }[state] ?? t("settings.permissionUnknown"));
  const { backgroundLocationState, enableStepTracking, healthConnectState, locationState, pedometerState, requestForegroundLocation, setBackgroundTrackingEnabled, setDailyStepGoal, setHeightCm, setWeightKg, settings, syncDailySteps } = useFitness();
  const [featureSettings, setFeatureSettings] = useState<FeatureSettings>(DEFAULT_FEATURE_SETTINGS);
  const [heightText, setHeightText] = useState("");
  const [weightText, setWeightText] = useState("");
  const featureSettingsRef = useRef(featureSettings);
  const pendingVoiceSelectionRef = useRef<{ role: "primary" | "secondary"; language: VoiceLanguage; enableAfterInstall?: boolean } | null>(null);

  useEffect(() => { void readFeatureSettings().then((value) => { featureSettingsRef.current = value; setFeatureSettings(value); }).catch(() => undefined); }, []);
  useEffect(() => { setHeightText(settings.heightCm ? String(settings.heightCm) : ""); }, [settings.heightCm]);
  useEffect(() => { setWeightText(settings.weightKg ? String(settings.weightKg) : ""); }, [settings.weightKg]);
  const saveFeatureSettings = async (next: FeatureSettings) => { featureSettingsRef.current = next; setFeatureSettings(next); await writeFeatureSettings(next); };
  const updateBackgroundTracking = async (enabled: boolean) => {
    if (!enabled) { await setBackgroundTrackingEnabled(false); return; }
    Alert.alert(t("settings.backgroundPromptTitle"), t("settings.backgroundPromptBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.continueSetup"), onPress: async () => { if (!await setBackgroundTrackingEnabled(true)) Alert.alert(t("settings.backgroundNotEnabledTitle"), t("settings.backgroundNotEnabledBody")); } },
    ]);
  };
  const requestSteps = async () => { if (!await enableStepTracking()) Alert.alert(t("settings.stepsNotEnabledTitle"), t("settings.stepsNotEnabledBody")); };
  const manageHealthConnect = async () => {
    if (healthConnectState === "granted") { if (!await openHealthConnectSettings()) Alert.alert(t("settings.healthOpenFailTitle"), t("settings.healthOpenFailBody")); return; }
    if (await enableStepTracking()) await syncDailySteps();
  };
  const requestLocation = async () => { if (!await requestForegroundLocation()) Alert.alert(t("settings.locationNotEnabledTitle"), t("settings.locationNotEnabledBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("common.openSettings"), onPress: () => Linking.openSettings() }]); };
  const setVoiceInterval = (minutes: VoiceIntervalMinutes) => { void saveFeatureSettings({ ...featureSettingsRef.current, voiceAnnouncementIntervalMinutes: minutes }); };
  const setVoiceDistanceInterval = (meters: VoiceDistanceIntervalMeters) => { void saveFeatureSettings({ ...featureSettingsRef.current, voiceDistanceIntervalMeters: meters }); };
  const setVoiceMode = (voiceMode: VoiceMode) => {
    void saveFeatureSettings({ ...featureSettingsRef.current, voiceMode }).then(async () => {
      if (voiceMode !== "bilingual") return;
      const current = featureSettingsRef.current;
      if (await resolveVoiceLanguage(current.voiceLanguage) === await resolveVoiceLanguage(current.secondaryVoiceLanguage)) {
        Alert.alert(t("settings.voiceSameLanguageTitle"), t("settings.voiceSameLanguageBody"));
      }
    });
  };
  const setVoiceCueBasis = (voiceCueBasis: VoiceCueBasis) => { void saveFeatureSettings({ ...featureSettingsRef.current, voiceCueBasis }); };
  const voiceLanguageOptions: Array<{ value: VoiceLanguage; label: string }> = [
    { value: "follow-interface", label: t("settings.followInterface") },
    { value: "zh-TW", label: "繁體中文" },
    { value: "en", label: "English" },
    { value: "ja", label: "日本語" },
    { value: "th", label: "ไทย" },
    { value: "ko", label: "한국어" },
    { value: "nan-TW", label: "台語" },
  ];
  const languageLabel = (value: VoiceLanguage) => voiceLanguageOptions.find((option) => option.value === value)?.label ?? value;
  const applyVoiceLanguage = async (role: "primary" | "secondary", voiceLanguage: VoiceLanguage) => {
    const current = featureSettingsRef.current;
    const other = role === "primary" ? current.secondaryVoiceLanguage : current.voiceLanguage;
    if (current.voiceMode === "bilingual" && await resolveVoiceLanguage(other) === await resolveVoiceLanguage(voiceLanguage)) {
      Alert.alert(t("settings.voiceSameLanguageTitle"), t("settings.voiceSameLanguageBody"));
      return false;
    }
    const next = role === "primary" ? { ...current, voiceLanguage } : { ...current, secondaryVoiceLanguage: voiceLanguage };
    await saveFeatureSettings(next);
    return true;
  };
  const promptVoiceInstall = (role: "primary" | "secondary", voiceLanguage: VoiceLanguage, enableAfterInstall = false) => {
    pendingVoiceSelectionRef.current = { role, language: voiceLanguage, enableAfterInstall };
    const label = languageLabel(voiceLanguage);
    const title = voiceLanguage === "nan-TW" ? t("settings.taiwaneseVoiceInstallTitle") : t("settings.voiceUnavailableTitle", { language: label });
    const body = voiceLanguage === "nan-TW" ? t("settings.taiwaneseVoiceInstallBody") : t("settings.voiceUnavailableBody", { language: label });
    if (voiceLanguage === "nan-TW") {
      pendingVoiceSelectionRef.current = null;
      Alert.alert(title, body, [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("settings.openPlayStoreAction"), onPress: () => { void openGooglePlayUpdatePage(); } },
      ]);
      return;
    }
    Alert.alert(title, body, [
      { text: t("common.cancel"), style: "cancel", onPress: () => { pendingVoiceSelectionRef.current = null; } },
      { text: t("settings.voiceInstall"), onPress: () => { void installVoiceLanguage(voiceLanguage); } },
    ]);
  };
  const chooseVoiceLanguage = async (role: "primary" | "secondary", voiceLanguage: VoiceLanguage) => {
    clearVoiceEngineCache();
    if (await isVoiceLanguageAvailable(voiceLanguage)) { await applyVoiceLanguage(role, voiceLanguage); return; }
    promptVoiceInstall(role, voiceLanguage);
  };
  const toggleVoiceAnnouncements = async (enabled: boolean) => {
    if (!enabled) { await saveFeatureSettings({ ...featureSettingsRef.current, voiceAnnouncementsEnabled: false }); return; }
    const current = featureSettingsRef.current;
    if (current.voiceMode === "bilingual" && await resolveVoiceLanguage(current.voiceLanguage) === await resolveVoiceLanguage(current.secondaryVoiceLanguage)) {
      Alert.alert(t("settings.voiceSameLanguageTitle"), t("settings.voiceSameLanguageBody"));
      return;
    }
    clearVoiceEngineCache();
    if (!await isVoiceLanguageAvailable(current.voiceLanguage)) {
      promptVoiceInstall("primary", current.voiceLanguage, true);
      return;
    }
    if (current.voiceMode === "bilingual" && !await isVoiceLanguageAvailable(current.secondaryVoiceLanguage)) {
      promptVoiceInstall("secondary", current.secondaryVoiceLanguage, true);
      return;
    }
    await saveFeatureSettings({ ...featureSettingsRef.current, voiceAnnouncementsEnabled: true });
  };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const pending = pendingVoiceSelectionRef.current;
      if (!pending) return;
      setTimeout(() => {
        clearVoiceEngineCache();
        void isVoiceLanguageAvailable(pending.language).then(async (available) => {
          if (pendingVoiceSelectionRef.current !== pending) return;
          pendingVoiceSelectionRef.current = null;
          if (!available) {
            Alert.alert(
              t("settings.voiceStillUnavailableTitle"),
              t("settings.voiceStillUnavailableBody", { language: languageLabel(pending.language) }),
              [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("settings.openTtsSettings"), onPress: () => { void openVoiceTtsSettings(); } },
              ],
            );
            return;
          }
          if (!await applyVoiceLanguage(pending.role, pending.language)) return;
          if (pending.enableAfterInstall) {
            const current = featureSettingsRef.current;
            const primaryReady = await isVoiceLanguageAvailable(current.voiceLanguage);
            const secondaryReady = current.voiceMode !== "bilingual" || await isVoiceLanguageAvailable(current.secondaryVoiceLanguage);
            if (primaryReady && secondaryReady) await saveFeatureSettings({ ...featureSettingsRef.current, voiceAnnouncementsEnabled: true });
          }
          Alert.alert(t("settings.voiceReadyTitle"), t("settings.voiceReadyBody", { language: languageLabel(pending.language) }));
        });
      }, 700);
    });
    return () => subscription.remove();
  }, [t]);
  const saveHeight = async () => {
    const raw = heightText.trim();
    if (!raw) { await setHeightCm(null); return; }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 100 || value > 230) { Alert.alert(t("settings.personalInvalidTitle"), t("settings.heightInvalidBody")); setHeightText(settings.heightCm ? String(settings.heightCm) : ""); return; }
    await setHeightCm(value);
  };
  const saveWeight = async () => {
    const raw = weightText.trim();
    if (!raw) { await setWeightKg(null); return; }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 30 || value > 250) { Alert.alert(t("settings.personalInvalidTitle"), t("settings.weightInvalidBody")); setWeightText(settings.weightKg ? String(settings.weightKg) : ""); return; }
    await setWeightKg(value);
  };
  const checkUpdate = async () => {
    const result = await checkForPlayUpdate(true);
    if (result === "none") Alert.alert(t("update.latestTitle"), t("update.currentVersion", { version: getCurrentAppVersion() }));
    else if (result === "available") Alert.alert(t("update.availableTitle"), t("update.availableBody"));
    else if (result === "started") Alert.alert(t("update.progressTitle"), t("update.progressDownload"));
    else if (result === "in_progress") Alert.alert(t("update.progressTitle"), t("update.progressBody"));
    else if (result === "downloaded") Alert.alert(t("update.downloadedTitle"), t("update.downloadedBody"));
    else if (result === "canceled") Alert.alert(t("update.canceledTitle"), t("update.canceledBody"));
    else if (result === "error") Alert.alert(t("update.errorTitle"), t("update.errorBody"));
    else if (result === "unsupported") Alert.alert(t("update.unsupported"));
  };

  return <ScreenContainer className="px-5" containerClassName="bg-background"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><Text style={styles.eyebrow}>{t("settings.eyebrow")}</Text><Text style={styles.title}>{t("settings.title")}</Text></View>

    <Text style={styles.sectionTitle}>{t("settings.languageSection")}</Text>
    <View style={styles.group}><View style={[styles.backgroundRow, { alignItems: "flex-start", paddingVertical: 14 }]}><View style={styles.settingIcon}><MaterialIcons name="language" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.language")}</Text><Text style={styles.settingDetail}>{t("settings.languageDetail")}</Text><View style={styles.languageButtons}>{LANGUAGE_OPTIONS.map((option) => <Pressable key={option.value} onPress={() => void setLanguage(option.value as AppLanguage)} style={[styles.languageButton, language === option.value && styles.languageButtonActive]}><Text style={[styles.languageButtonText, language === option.value && styles.languageButtonTextActive]}>{option.value === "system" ? t("settings.systemLanguage") : option.nativeLabel}</Text></Pressable>)}</View></View></View></View>

    <Text style={styles.sectionTitle}>{t("settings.dailySteps")}</Text>
    <View style={styles.goalCard}><View><Text style={styles.settingLabel}>{t("settings.dailyGoal")}</Text><Text style={styles.goalValue}>{formatNumber(settings.dailyStepGoal)} {t("common.steps")}</Text></View><View style={styles.goalControls}><Pressable onPress={() => setDailyStepGoal(settings.dailyStepGoal - 1_000)} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><MaterialIcons name="remove" size={21} color="#1479FF" /></Pressable><Pressable onPress={() => setDailyStepGoal(settings.dailyStepGoal + 1_000)} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><MaterialIcons name="add" size={21} color="#1479FF" /></Pressable></View></View>

    <Text style={styles.sectionTitle}>{t("settings.personalData")}</Text>
    <View style={styles.group}>
      <View style={styles.personalRow}><View style={styles.settingIcon}><MaterialIcons name="height" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.height")}</Text><Text style={styles.settingDetail}>{t("settings.heightDetail")}</Text></View><View style={styles.inputWrap}><TextInput value={heightText} onChangeText={setHeightText} onBlur={() => void saveHeight()} keyboardType="number-pad" placeholder="—" style={styles.numberInput} /><Text style={styles.inputUnit}>cm</Text></View></View>
      <View style={styles.divider} />
      <View style={styles.personalRow}><View style={styles.settingIcon}><MaterialIcons name="monitor-weight" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.weight")}</Text><Text style={styles.settingDetail}>{t("settings.weightDetail")}</Text></View><View style={styles.inputWrap}><TextInput value={weightText} onChangeText={setWeightText} onBlur={() => void saveWeight()} keyboardType="decimal-pad" placeholder="—" style={styles.numberInput} /><Text style={styles.inputUnit}>kg</Text></View></View>
    </View><Text style={styles.note}>{t("settings.personalNote")}</Text>

    <Text style={styles.sectionTitle}>{t("settings.stepSources")}</Text><View style={styles.group}><SettingRow icon="health-and-safety" title={t("settings.healthConnectDaily")} detail={permissionLabel(healthConnectState)} action={healthConnectState === "granted" ? t("common.manage") : t("common.enable")} onPress={manageHealthConnect} /><View style={styles.divider} /><SettingRow icon="directions-walk" title={t("settings.liveWorkoutSteps")} detail={permissionLabel(pedometerState)} action={t("common.enable")} onPress={requestSteps} /></View><Text style={styles.note}>{t("settings.stepSourceNote")}</Text>

    <Text style={styles.sectionTitle}>{t("settings.locationTrack")}</Text><View style={styles.group}><SettingRow icon="location-on" title={t("settings.preciseLocation")} detail={permissionLabel(locationState)} action={t("common.setup")} onPress={requestLocation} /><View style={styles.divider} /><View style={styles.backgroundRow}><View style={styles.settingIcon}><MaterialIcons name="my-location" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.backgroundRoute")}</Text><Text style={styles.settingDetail}>{Platform.OS === "web" ? t("settings.androidOnly") : permissionLabel(backgroundLocationState)}</Text></View><Switch value={settings.backgroundTrackingEnabled} onValueChange={updateBackgroundTracking} trackColor={{ false: "#D6DEE8", true: "#A9CEFF" }} thumbColor={settings.backgroundTrackingEnabled ? "#1479FF" : "#FFFFFF"} /></View></View><Text style={styles.note}>{t("settings.backgroundNote")}</Text>

    <Text style={styles.sectionTitle}>{t("settings.voice")}</Text>
    <View style={styles.group}>
      <View style={styles.backgroundRow}><View style={styles.settingIcon}><MaterialIcons name="record-voice-over" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.workoutVoice")}</Text><Text style={styles.settingDetail}>{t("settings.voiceDetail")}</Text></View><Switch value={featureSettings.voiceAnnouncementsEnabled} onValueChange={(enabled) => void toggleVoiceAnnouncements(enabled)} trackColor={{ false: "#D6DEE8", true: "#A9CEFF" }} thumbColor={featureSettings.voiceAnnouncementsEnabled ? "#1479FF" : "#FFFFFF"} /></View>
      <View style={styles.divider} />
      <View style={styles.intervalRow}><Text style={styles.settingLabel}>{t("settings.voiceMode")}</Text><View style={styles.intervalButtons}>{(["single", "bilingual"] as VoiceMode[]).map((mode) => <Pressable key={mode} onPress={() => setVoiceMode(mode)} style={[styles.intervalButton, featureSettings.voiceMode === mode && styles.intervalButtonActive]}><Text style={[styles.intervalButtonText, featureSettings.voiceMode === mode && styles.intervalButtonTextActive]}>{t(mode === "single" ? "settings.voiceModeSingle" : "settings.voiceModeBilingual")}</Text></Pressable>)}</View></View>
      <View style={styles.divider} />
      <View style={styles.intervalRow}><Text style={styles.settingLabel}>{t("settings.voiceCueBasis")}</Text><View style={styles.intervalButtons}>{(["time", "distance"] as VoiceCueBasis[]).map((basis) => <Pressable key={basis} onPress={() => setVoiceCueBasis(basis)} style={[styles.intervalButton, featureSettings.voiceCueBasis === basis && styles.intervalButtonActive]}><Text style={[styles.intervalButtonText, featureSettings.voiceCueBasis === basis && styles.intervalButtonTextActive]}>{t(basis === "time" ? "settings.voiceCueTime" : "settings.voiceCueDistance")}</Text></Pressable>)}</View></View>
      <View style={styles.divider} />
      {featureSettings.voiceCueBasis === "time" ? <View style={styles.intervalRow}><Text style={styles.settingLabel}>{t("settings.voiceInterval")}</Text><View style={styles.intervalButtons}>{([5, 10, 15] as VoiceIntervalMinutes[]).map((minutes) => <Pressable key={minutes} onPress={() => setVoiceInterval(minutes)} style={[styles.intervalButton, featureSettings.voiceAnnouncementIntervalMinutes === minutes && styles.intervalButtonActive]}><Text style={[styles.intervalButtonText, featureSettings.voiceAnnouncementIntervalMinutes === minutes && styles.intervalButtonTextActive]}>{t("settings.minutesShort", { minutes })}</Text></Pressable>)}</View></View> : <View style={styles.intervalRow}><Text style={styles.settingLabel}>{t("settings.voiceDistanceInterval")}</Text><View style={styles.intervalButtons}>{([500, 1000, 2000, 5000] as VoiceDistanceIntervalMeters[]).map((meters) => <Pressable key={meters} onPress={() => setVoiceDistanceInterval(meters)} style={[styles.intervalButton, featureSettings.voiceDistanceIntervalMeters === meters && styles.intervalButtonActive]}><Text style={[styles.intervalButtonText, featureSettings.voiceDistanceIntervalMeters === meters && styles.intervalButtonTextActive]}>{meters === 500 ? "0.5 km" : `${meters / 1000} km`}</Text></Pressable>)}</View></View>}
      <View style={styles.divider} />
      <View style={[styles.backgroundRow, { alignItems: "flex-start", paddingVertical: 14 }]}><View style={styles.settingIcon}><MaterialIcons name="translate" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t(featureSettings.voiceMode === "bilingual" ? "settings.voicePrimaryLanguage" : "settings.voiceLanguage")}</Text><Text style={styles.settingDetail}>{t("settings.voiceLanguageDetail")}</Text><View style={styles.languageButtons}>{voiceLanguageOptions.map((option) => <Pressable key={option.value} onPress={() => void chooseVoiceLanguage("primary", option.value)} style={[styles.languageButton, featureSettings.voiceLanguage === option.value && styles.languageButtonActive]}><Text style={[styles.languageButtonText, featureSettings.voiceLanguage === option.value && styles.languageButtonTextActive]}>{option.label}</Text></Pressable>)}</View></View></View>
      {featureSettings.voiceMode === "bilingual" ? <><View style={styles.divider} /><View style={[styles.backgroundRow, { alignItems: "flex-start", paddingVertical: 14 }]}><View style={styles.settingIcon}><MaterialIcons name="record-voice-over" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.voiceSecondaryLanguage")}</Text><Text style={styles.settingDetail}>{t("settings.voiceSecondaryDetail")}</Text><View style={styles.languageButtons}>{voiceLanguageOptions.map((option) => <Pressable key={option.value} onPress={() => void chooseVoiceLanguage("secondary", option.value)} style={[styles.languageButton, featureSettings.secondaryVoiceLanguage === option.value && styles.languageButtonActive]}><Text style={[styles.languageButtonText, featureSettings.secondaryVoiceLanguage === option.value && styles.languageButtonTextActive]}>{option.label}</Text></Pressable>)}</View></View></View></> : null}
    </View>
    <Text style={styles.note}>{t("settings.voiceInstallNote")}</Text>

    <Text style={styles.sectionTitle}>{t("settings.update")}</Text><View style={styles.group}><View style={styles.backgroundRow}><View style={styles.settingIcon}><MaterialIcons name="system-update" size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{t("settings.autoUpdate")}</Text><Text style={styles.settingDetail}>{t("settings.autoUpdateDetail", { version: getCurrentAppVersion() })}</Text></View><Switch value={featureSettings.autoUpdateCheckEnabled} onValueChange={(enabled) => void saveFeatureSettings({ ...featureSettings, autoUpdateCheckEnabled: enabled })} trackColor={{ false: "#D6DEE8", true: "#A9CEFF" }} thumbColor={featureSettings.autoUpdateCheckEnabled ? "#1479FF" : "#FFFFFF"} /></View><View style={styles.divider} /><SettingRow icon="refresh" title={t("settings.checkNow")} detail={t("settings.playUpdate")} action={t("common.check")} onPress={checkUpdate} /><View style={styles.divider} /><SettingRow icon="open-in-new" title={t("settings.openPlayStore")} detail={t("settings.playFallbackNote")} action={t("settings.openPlayStoreAction")} onPress={() => void openGooglePlayUpdatePage()} /></View><Text style={styles.note}>{t("settings.updateNote")}</Text>

    <Text style={styles.sectionTitle}>{t("settings.mapSource")}</Text><View style={styles.mapSourceCard}><MaterialIcons name="map" size={21} color="#1479FF" /><View style={styles.privacyCopy}><Text style={[styles.privacyTitle, { color: "#1479FF" }]}>MapLibre + OpenFreeMap</Text><Text style={[styles.privacyText, { color: "#536B86" }]}>{t("settings.mapDetail")}</Text></View></View>
    <Text style={styles.sectionTitle}>{t("settings.privacy")}</Text><View style={styles.privacyCard}><MaterialIcons name="lock-outline" size={21} color="#21A36A" /><View style={styles.privacyCopy}><Text style={styles.privacyTitle}>{t("settings.privacyTitle")}</Text><Text style={styles.privacyText}>{t("settings.privacyText")}</Text></View></View>
  </ScrollView></ScreenContainer>;
}

function SettingRow({ icon, title, detail, action, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; detail: string; action: string; onPress: () => void }) {
  return <View style={styles.settingRow}><View style={styles.settingIcon}><MaterialIcons name={icon} size={20} color="#1479FF" /></View><View style={styles.rowCopy}><Text style={styles.settingLabel}>{title}</Text><Text style={styles.settingDetail}>{detail}</Text></View><Pressable onPress={onPress} style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}><Text style={styles.textActionLabel}>{action}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  content: { paddingTop: 14, paddingBottom: 34 },
  header: { paddingBottom: 24 },
  eyebrow: { color: "#1479FF", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  title: { color: "#13202D", fontSize: 26, fontWeight: "800", letterSpacing: -0.8, marginTop: 3 },
  sectionTitle: { color: "#687586", fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginBottom: 9, marginTop: 22, textTransform: "uppercase" },
  goalCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 21, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: 17 },
  settingLabel: { color: "#13202D", fontSize: 15, fontWeight: "800" },
  goalValue: { color: "#1479FF", fontSize: 18, fontWeight: "800", marginTop: 4 },
  goalControls: { flexDirection: "row", gap: 9 },
  roundButton: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 17, height: 40, justifyContent: "center", width: 40 },
  group: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 21, borderWidth: 1, overflow: "hidden" },
  settingRow: { alignItems: "center", flexDirection: "row", minHeight: 72, paddingHorizontal: 15 },
  backgroundRow: { alignItems: "center", flexDirection: "row", minHeight: 78, paddingHorizontal: 15 },
  personalRow: { alignItems: "center", flexDirection: "row", minHeight: 82, paddingHorizontal: 15 },
  inputWrap: { alignItems: "center", backgroundColor: "#F5F7FA", borderRadius: 12, flexDirection: "row", paddingHorizontal: 10 },
  numberInput: { color: "#13202D", fontSize: 15, fontWeight: "800", minWidth: 52, paddingVertical: 9, textAlign: "right" },
  inputUnit: { color: "#687586", fontSize: 12, fontWeight: "700", marginLeft: 4 },
  settingIcon: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 14, height: 38, justifyContent: "center", marginRight: 12, width: 38 },
  rowCopy: { flex: 1 },
  settingDetail: { color: "#687586", fontSize: 12, fontWeight: "600", marginTop: 3 },
  textAction: { paddingHorizontal: 8, paddingVertical: 8 },
  textActionLabel: { color: "#1479FF", fontSize: 13, fontWeight: "800" },
  divider: { backgroundColor: "#EEF1F5", height: 1, marginLeft: 65 },
  note: { color: "#687586", fontSize: 12, lineHeight: 18, marginTop: 9, paddingHorizontal: 4 },
  intervalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 72, paddingHorizontal: 15 },
  intervalButtons: { flexDirection: "row", flexShrink: 1, flexWrap: "wrap", gap: 7, justifyContent: "flex-end" },
  intervalButton: { backgroundColor: "#EEF2F6", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  intervalButtonActive: { backgroundColor: "#1479FF" },
  intervalButtonText: { color: "#687586", fontSize: 12, fontWeight: "800" },
  intervalButtonTextActive: { color: "#FFFFFF" },
  privacyCard: { alignItems: "flex-start", backgroundColor: "#F0FBF6", borderColor: "#D8F2E5", borderRadius: 20, borderWidth: 1, flexDirection: "row", padding: 17 },
  mapSourceCard: { alignItems: "flex-start", backgroundColor: "#EAF2FF", borderColor: "#CFE1FF", borderRadius: 20, borderWidth: 1, flexDirection: "row", padding: 17 },
  privacyCopy: { flex: 1, marginLeft: 11 },
  privacyTitle: { color: "#168553", fontSize: 15, fontWeight: "800" },
  privacyText: { color: "#467664", fontSize: 12, lineHeight: 18, marginTop: 5 },
  languageButtons: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  languageButton: { backgroundColor: "#EEF2F6", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  languageButtonActive: { backgroundColor: "#1479FF" },
  languageButtonText: { color: "#687586", fontSize: 12, fontWeight: "800" },
  languageButtonTextActive: { color: "#FFFFFF" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
