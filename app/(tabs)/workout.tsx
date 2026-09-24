import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { MetricCard } from "@/components/metric-card";
import { ScreenContainer } from "@/components/screen-container";
import { WorkoutMap } from "@/components/workout-map";
import { useFitness } from "@/lib/fitness/fitness-provider";
import { formatDistance, formatDuration, formatPace, formatPaceFromSpeedMps, formatSpeed, formatSpeedMps, getElapsedSeconds, recentSpeedMps } from "@/lib/fitness/math";
import { announceWorkoutState, clearWorkoutVoiceProgress, maybeAnnounceWorkoutProgress } from "@/lib/fitness/speech";
import { useI18n } from "@/lib/i18n";
import type { WorkoutType } from "@/lib/fitness/types";

const modes: Array<{ type: WorkoutType; icon: keyof typeof MaterialIcons.glyphMap; copyKey: string }> = [
  { type: "walk", icon: "directions-walk", copyKey: "workout.modeWalkCopy" },
  { type: "run", icon: "directions-run", copyKey: "workout.modeRunCopy" },
  { type: "shopping", icon: "shopping-bag", copyKey: "workout.modeShoppingCopy" },
  { type: "bike", icon: "directions-bike", copyKey: "workout.modeBikeCopy" },
];

export default function WorkoutScreen() {
  const router = useRouter();
  const { t, locale, formatNumber } = useI18n();
  const params = useLocalSearchParams<{ mode?: string }>();
  const requestedMode = modes.some((mode) => mode.type === params.mode) ? params.mode as WorkoutType : null;
  const [selectedType, setSelectedType] = useState<WorkoutType>(requestedMode ?? "walk");
  const {
    activeWorkout, backgroundLocationState, completeWorkout, liveWorkoutSteps, gpsFixState, locationMessage, pedometerMessage,
    pauseWorkout, resumeWorkout, setBackgroundTrackingEnabled, settings, startWorkout,
  } = useFitness();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const isRecording = activeWorkout?.status === "active";
  const workoutLabel = (type: WorkoutType) => t(`workout.${type}`);

  useEffect(() => { if (requestedMode) setSelectedType(requestedMode); }, [requestedMode]);
  useEffect(() => {
    if (!activeWorkout) { setElapsedSeconds(0); return; }
    const refresh = () => setElapsedSeconds(getElapsedSeconds(activeWorkout));
    refresh(); const timer = setInterval(refresh, 1_000); return () => clearInterval(timer);
  }, [activeWorkout]);
  useEffect(() => {
    if (!activeWorkout || activeWorkout.status !== "active") return;
    void maybeAnnounceWorkoutProgress(activeWorkout);
    const timer = setInterval(() => { void maybeAnnounceWorkoutProgress(activeWorkout); }, 10_000);
    return () => clearInterval(timer);
  }, [activeWorkout]);

  const handleStart = async (type: WorkoutType) => {
    try { const started = await startWorkout(type); await announceWorkoutState(started.type, "start"); }
    catch (error) { Alert.alert(t("workout.startFailTitle"), error instanceof Error ? error.message : t("workout.startFailBody")); }
  };

  const handlePauseResume = async () => {
    if (!activeWorkout) return;
    if (activeWorkout.status === "active") { await pauseWorkout(); await announceWorkoutState(activeWorkout.type, "pause"); }
    else { await resumeWorkout(); await announceWorkoutState(activeWorkout.type, "resume"); }
  };

  const enableBackground = () => {
    Alert.alert(t("workout.backgroundPromptTitle"), t("workout.backgroundPromptBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.enable"), onPress: async () => { if (!await setBackgroundTrackingEnabled(true)) Alert.alert(t("workout.backgroundPermissionTitle"), t("workout.backgroundPermissionBody")); } },
    ]);
  };

  const handleStop = () => Alert.alert(t("workout.endPromptTitle"), t("workout.endPromptBody"), [
    { text: t("workout.continueRecording"), style: "cancel" },
    { text: t("workout.endWorkout"), style: "destructive", onPress: async () => {
      const completed = await completeWorkout();
      if (completed) { await announceWorkoutState(completed.type, "end", completed); await clearWorkoutVoiceProgress(completed.id); router.replace("/(tabs)" as never); }
    } },
  ]);

  if (!activeWorkout) {
    const backgroundReady = settings.backgroundTrackingEnabled && backgroundLocationState === "granted";
    return <ScreenContainer className="px-5" containerClassName="bg-background"><ScrollView contentContainerStyle={styles.modePage} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>{t("workout.kicker")}</Text>
      <Text style={styles.pageTitle}>{t("workout.title")}</Text>
      <Text style={styles.modeIntro}>{t("workout.intro")}</Text>
      {!backgroundReady ? <Pressable onPress={enableBackground} style={({ pressed }) => [styles.backgroundNotice, pressed && styles.pressed]}><MaterialIcons name="screen-lock-portrait" size={22} color="#B46B14" /><View style={{ flex: 1 }}><Text style={styles.backgroundNoticeTitle}>{t("workout.backgroundOffTitle")}</Text><Text style={styles.backgroundNoticeCopy}>{t("workout.backgroundOffCopy")}</Text></View><MaterialIcons name="chevron-right" size={22} color="#B46B14" /></Pressable> : <View style={styles.backgroundReady}><MaterialIcons name="verified" size={20} color="#168553" /><Text style={styles.backgroundReadyText}>{t("workout.backgroundReady")}</Text></View>}
      {modes.map((mode) => <Pressable key={mode.type} onPress={() => setSelectedType(mode.type)} style={({ pressed }) => [styles.modeCard, selectedType === mode.type && styles.modeCardSelected, pressed && styles.pressed]}><View style={styles.modeIcon}><MaterialIcons name={mode.icon} size={29} color="#1479FF" /></View><View style={styles.modeText}><Text style={styles.modeTitle}>{workoutLabel(mode.type)}</Text><Text style={styles.modeCopy}>{t(mode.copyKey)}</Text></View><MaterialIcons name="chevron-right" size={24} color="#9DAABA" /></Pressable>)}
      <Pressable onPress={() => void handleStart(selectedType)} style={({ pressed }) => [styles.startModeButton, pressed && styles.pressed]}><MaterialIcons name="play-arrow" size={22} color="#FFFFFF" /><Text style={styles.startModeButtonText}>{t("workout.startMode", { mode: workoutLabel(selectedType) })}</Text></Pressable>
      {locationMessage ? <Text style={styles.errorText}>{locationMessage}</Text> : null}
      {pedometerMessage ? <Text style={styles.warningText}>{pedometerMessage}</Text> : null}
    </ScrollView></ScreenContainer>;
  }

  const isBike = activeWorkout.type === "bike";
  const isShopping = activeWorkout.type === "shopping";
  const currentSpeedMps = recentSpeedMps(activeWorkout.route);
  const gpsStatusLabel = !isRecording ? t("workout.statusPaused") : gpsFixState === "fixed" ? t("workout.statusFixed") : gpsFixState === "weak" ? t("workout.statusWeak") : gpsFixState === "off" ? t("workout.statusOff") : t("workout.statusSearching");
  return <ScreenContainer className="px-5" containerClassName="bg-background"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.topRow}><View><Text style={styles.kicker}>{isRecording ? t("workout.recording") : t("workout.paused")}</Text><Text style={styles.pageTitle}>{workoutLabel(activeWorkout.type)}</Text></View><View style={[styles.statusPill, !isRecording && styles.pausedPill]}><View style={[styles.dot, !isRecording && styles.pausedDot]} /><Text style={[styles.statusText, !isRecording && styles.pausedText]}>{gpsStatusLabel}</Text></View></View>
    <View style={styles.mapFrame}><WorkoutMap route={activeWorkout.route} /></View>
    {isShopping ? <>
      <View style={styles.primaryMetric}><Text style={styles.primaryMetricLabel}>{t("workout.shoppingTime")}</Text><Text style={styles.primaryMetricValue}>{formatDuration(elapsedSeconds)}</Text><Text style={styles.primaryMetricSupport}>{t("workout.movingDistance", { distance: formatDistance(activeWorkout.distanceMeters, locale) })}</Text></View>
      <View style={styles.metricsRow}><MetricCard label={t("workout.workoutSteps")} value={formatNumber(liveWorkoutSteps)} accent="#21A36A" /><View style={styles.metricGap} /><MetricCard label={t("workout.distance")} value={formatDistance(activeWorkout.distanceMeters, locale)} accent="#1479FF" /></View>
    </> : <>
      <View style={styles.primaryMetric}><Text style={styles.primaryMetricLabel}>{t("workout.distance")}</Text><Text style={styles.primaryMetricValue}>{formatDistance(activeWorkout.distanceMeters, locale)}</Text><Text style={styles.primaryMetricSupport}>{t("workout.workoutTime", { time: formatDuration(elapsedSeconds) })}</Text></View>
      <View style={styles.metricsRow}><MetricCard label={isBike ? t("workout.currentSpeed") : t("workout.currentPace")} value={isBike ? formatSpeedMps(currentSpeedMps) : formatPaceFromSpeedMps(currentSpeedMps)} accent="#1479FF" /><View style={styles.metricGap} /><MetricCard label={isBike ? t("workout.averageSpeed") : t("workout.averagePace")} value={isBike ? formatSpeed(activeWorkout.distanceMeters, elapsedSeconds) : formatPace(activeWorkout.distanceMeters, elapsedSeconds)} accent="#1479FF" /></View>
      <View style={styles.metricsRow}><MetricCard label={isBike ? t("workout.maxSpeed") : t("workout.workoutSteps")} value={isBike ? formatSpeedMps(activeWorkout.maxSpeedMps) : formatNumber(liveWorkoutSteps)} accent="#21A36A" /><View style={styles.metricGap} /><View style={{ flex: 1 }} /></View>
    </>}
    {locationMessage ? <Text style={styles.errorText}>{locationMessage}</Text> : null}{pedometerMessage ? <Text style={styles.warningText}>{pedometerMessage}</Text> : null}
    <View style={styles.actions}><Pressable onPress={handlePauseResume} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MaterialIcons name={isRecording ? "pause" : "play-arrow"} size={23} color="#1479FF" /><Text style={styles.secondaryButtonText}>{isRecording ? t("common.pause") : t("common.resume")}</Text></Pressable><Pressable onPress={handleStop} style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}><MaterialIcons name="stop" size={21} color="#FFFFFF" /><Text style={styles.stopButtonText}>{t("common.end")}</Text></Pressable></View>
  </ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create({
  modePage: { paddingTop: 24, paddingBottom: 36, gap: 14 },
  modeIntro: { color: "#687586", fontSize: 14, lineHeight: 21, marginBottom: 5 },
  modeCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 22, borderWidth: 1, flexDirection: "row", padding: 18 },
  modeCardSelected: { backgroundColor: "#F1F7FF", borderColor: "#1479FF" },
  modeIcon: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 18, height: 54, justifyContent: "center", width: 54 },
  modeText: { flex: 1, marginLeft: 14 },
  modeTitle: { color: "#13202D", fontSize: 18, fontWeight: "800" },
  modeCopy: { color: "#687586", fontSize: 12, lineHeight: 18, marginTop: 4 },
  startModeButton: { alignItems: "center", backgroundColor: "#1479FF", borderRadius: 17, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 56, marginTop: 2 },
  startModeButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  backgroundNotice: { alignItems: "center", backgroundColor: "#FFF7EA", borderColor: "#F2D49E", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, padding: 14 },
  backgroundNoticeTitle: { color: "#8D5512", fontSize: 14, fontWeight: "800" },
  backgroundNoticeCopy: { color: "#9C6C32", fontSize: 11, lineHeight: 17, marginTop: 3 },
  backgroundReady: { alignItems: "center", backgroundColor: "#EFFAF4", borderColor: "#D1EFDF", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  backgroundReadyText: { color: "#168553", fontSize: 13, fontWeight: "800" },
  content: { paddingTop: 10, paddingBottom: 34, gap: 16 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  kicker: { color: "#1479FF", fontSize: 13, fontWeight: "800", letterSpacing: 0.8 },
  pageTitle: { color: "#13202D", fontSize: 26, fontWeight: "800", letterSpacing: -0.7, marginTop: 3 },
  statusPill: { alignItems: "center", backgroundColor: "#EAF8F1", borderRadius: 18, flexDirection: "row", gap: 6, paddingHorizontal: 11, paddingVertical: 8 },
  pausedPill: { backgroundColor: "#FFF4E4" },
  dot: { backgroundColor: "#21A36A", borderRadius: 4, height: 8, width: 8 },
  pausedDot: { backgroundColor: "#E9932D" },
  statusText: { color: "#168553", fontSize: 12, fontWeight: "800" },
  pausedText: { color: "#B46B14" },
  mapFrame: { height: 250 },
  primaryMetric: { alignItems: "center", backgroundColor: "#13202D", borderRadius: 25, paddingVertical: 18 },
  primaryMetricLabel: { color: "#AAB8C7", fontSize: 13, fontWeight: "700" },
  primaryMetricValue: { color: "#FFFFFF", fontSize: 35, fontWeight: "800", letterSpacing: -1.1, marginTop: 2 },
  primaryMetricSupport: { color: "#BFD9FF", fontSize: 13, fontWeight: "700", marginTop: 3 },
  metricsRow: { flexDirection: "row" },
  metricGap: { width: 12 },
  actions: { flexDirection: "row", gap: 12, marginTop: 4 },
  secondaryButton: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 17, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 56 },
  secondaryButtonText: { color: "#1479FF", fontSize: 16, fontWeight: "800" },
  stopButton: { alignItems: "center", backgroundColor: "#E34B4B", borderRadius: 17, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 56 },
  stopButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  errorText: { color: "#D03B3B", fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 8, textAlign: "center" },
  warningText: { color: "#9C6C32", fontSize: 13, fontWeight: "700", lineHeight: 19, marginTop: 8, textAlign: "center" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
