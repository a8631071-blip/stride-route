import { useEffect } from "react";
import { useRouter } from "expo-router";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { StepProgress } from "@/components/step-progress";
import { useFitness } from "@/lib/fitness/fitness-provider";
import { dateKey, estimateDistanceFromSteps, estimateStepLengthMeters, formatDistance, formatDuration, getElapsedSeconds } from "@/lib/fitness/math";
import { useI18n } from "@/lib/i18n";

export default function TodayScreen() {
  const router = useRouter();
  const { t, locale, formatNumber, formatDate } = useI18n();
  const { activeWorkout, dailySteps, enableStepTracking, healthConnectState, isReady, markGpsRecommendationShown, pedometerState, sessions, settings, stepHistory } = useFitness();
  const todaySteps = dailySteps ?? 0;
  const goalPercentage = Math.min(Math.round((todaySteps / settings.dailyStepGoal) * 100), 100);
  const todayDistance = estimateDistanceFromSteps(todaySteps, estimateStepLengthMeters(settings.heightCm));
  const todayWorkoutSeconds = sessions.filter((s) => s.status === "completed" && dateKey(s.startedAt) === dateKey()).reduce((sum, s) => sum + s.durationSeconds, 0)
    + (activeWorkout && dateKey(activeWorkout.startedAt) === dateKey() ? getElapsedSeconds(activeWorkout) : 0);
  const last7 = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index));
    const key = dateKey(date.getTime());
    return { key, steps: key === dateKey() ? todaySteps : stepHistory[key] ?? 0, label: formatDate(date, { weekday: "short" }) };
  });
  const maxSteps = Math.max(1, ...last7.map((d) => d.steps));
  const stepSourceLabel = healthConnectState === "granted" && pedometerState === "granted"
    ? t("today.sourceCombined")
    : healthConnectState === "granted"
      ? t("today.sourceHealth")
      : pedometerState === "granted"
        ? t("today.sourceSensor")
        : t("today.sourceDisabled");
  const workoutLabel = (type: "walk" | "run" | "shopping" | "bike") => t(`workout.${type}`);

  useEffect(() => {
    if (!isReady || settings.gpsRecommendationShown) return;
    const timer = setTimeout(() => {
      void Location.hasServicesEnabledAsync().then((enabled) => {
        const acknowledge = () => void markGpsRecommendationShown().catch(() => undefined);
        Alert.alert(
          t("today.gpsRecommendationTitle"),
          t("today.gpsRecommendationBody"),
          enabled
            ? [{ text: t("common.gotIt"), onPress: acknowledge }]
            : [
                { text: t("common.later"), style: "cancel", onPress: acknowledge },
                { text: t("today.openGps"), onPress: async () => { acknowledge(); await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS").catch(() => undefined); } },
              ],
          { cancelable: false },
        );
      }).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [isReady, markGpsRecommendationShown, settings.gpsRecommendationShown, t]);

  const handleEnablePedometer = async () => {
    const granted = await enableStepTracking();
    if (!granted) Alert.alert(t("today.enableStepsFailTitle"), t("today.enableStepsFailBody"));
  };

  return <ScreenContainer className="px-5" containerClassName="bg-background"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>{t("today.brand")}</Text><Text style={styles.title}>{t("today.title")}</Text></View><View style={styles.dateBadge}><Text style={styles.dateText}>{formatDate(new Date(), { month: "short", day: "numeric" })}</Text></View></View>
    <View style={styles.heroCard}><StepProgress steps={isReady ? todaySteps : null} goal={settings.dailyStepGoal} /><View style={styles.goalRow}><View><Text style={styles.goalCopy}>{t("today.goal", { goal: formatNumber(settings.dailyStepGoal) })}</Text><Text style={styles.sourceCopy}>{stepSourceLabel}</Text></View><Text style={styles.goalValue}>{goalPercentage}%</Text></View>{healthConnectState !== "granted" || pedometerState !== "granted" ? <Pressable onPress={handleEnablePedometer} style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}><MaterialIcons name="directions-walk" size={19} color="#1479FF" /><Text style={styles.permissionButtonText}>{t("today.enableFullSteps")}</Text></Pressable> : null}</View>
    <View style={styles.summaryRow}><View style={styles.summaryCard}><Text style={styles.summaryLabel}>{t("today.estimatedDistance")}</Text><Text style={styles.summaryValue}>{formatDistance(todayDistance, locale)}</Text><Text style={styles.summaryHint}>{t(settings.heightCm ? "today.estimatedByHeight" : "today.estimatedBySteps")}</Text></View><View style={styles.summaryCard}><Text style={styles.summaryLabel}>{t("today.workoutTime")}</Text><Text style={styles.summaryValue}>{formatDuration(todayWorkoutSeconds)}</Text><Text style={styles.summaryHint}>{t("today.recordedWorkout")}</Text></View></View>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{t("today.recent7")}</Text><Pressable onPress={() => router.push("/(tabs)/analysis" as never)}><Text style={styles.link}>{t("today.fullAnalysis")}</Text></Pressable></View>
    <View style={styles.chartCard}><View style={styles.chart}>{last7.map((day) => <View key={day.key} style={styles.barColumn}><View style={[styles.bar, { height: Math.max(4, Math.round((day.steps / maxSteps) * 92)) }]} /><Text style={styles.barLabel}>{day.label}</Text></View>)}</View></View>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{t("today.startWorkout")}</Text><Text style={styles.sectionHint}>{t("today.gpsTrack")}</Text></View>
    <View style={styles.modeRow}>{(["walk", "run", "shopping", "bike"] as const).map((type) => <Pressable key={type} onPress={() => router.push({ pathname: "/(tabs)/workout", params: { mode: type } } as never)} style={({ pressed }) => [styles.modeButton, pressed && styles.pressed]}><MaterialIcons name={type === "walk" ? "directions-walk" : type === "run" ? "directions-run" : type === "shopping" ? "shopping-bag" : "directions-bike"} size={25} color="#1479FF" /><Text style={styles.modeLabel}>{workoutLabel(type)}</Text></Pressable>)}</View>
    {activeWorkout ? <Pressable onPress={() => router.push("/(tabs)/workout" as never)} style={({ pressed }) => [styles.activeCard, pressed && styles.pressed]}><MaterialIcons name="location-on" size={22} color="#1479FF" /><View style={styles.activeCopy}><Text style={styles.activeTitle}>{t("today.activeUnfinished", { mode: workoutLabel(activeWorkout.type) })}</Text><Text style={styles.activeText}>{t("today.activeReturn")}</Text></View><MaterialIcons name="chevron-right" size={22} color="#9DAABA" /></Pressable> : null}
  </ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create({ content: { paddingTop: 16, paddingBottom: 34, gap: 16 }, header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, eyebrow: { color: "#1479FF", fontSize: 13, fontWeight: "800", letterSpacing: 1 }, title: { color: "#13202D", fontSize: 28, fontWeight: "800", marginTop: 2 }, dateBadge: { backgroundColor: "#EEF4FB", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }, dateText: { color: "#526172", fontSize: 13, fontWeight: "700" }, heroCard: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 26, borderWidth: 1, padding: 20 }, goalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 12 }, goalCopy: { color: "#687586", fontSize: 13, fontWeight: "700" }, sourceCopy: { color: "#A0AAB5", fontSize: 10, marginTop: 3 }, goalValue: { color: "#1479FF", fontSize: 13, fontWeight: "800" }, permissionButton: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 14, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 14, paddingVertical: 11 }, permissionButtonText: { color: "#1479FF", fontSize: 14, fontWeight: "800" }, summaryRow: { flexDirection: "row", gap: 12 }, summaryCard: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 20, borderWidth: 1, flex: 1, padding: 16 }, summaryLabel: { color: "#7B8795", fontSize: 12, fontWeight: "700" }, summaryValue: { color: "#13202D", fontSize: 20, fontWeight: "800", marginTop: 6 }, summaryHint: { color: "#A0AAB5", fontSize: 10, marginTop: 3 }, sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 3 }, sectionTitle: { color: "#13202D", fontSize: 18, fontWeight: "800" }, sectionHint: { color: "#8A96A4", fontSize: 12, fontWeight: "700" }, link: { color: "#1479FF", fontSize: 13, fontWeight: "800" }, chartCard: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 22, borderWidth: 1, padding: 16 }, chart: { alignItems: "flex-end", flexDirection: "row", height: 125, justifyContent: "space-between" }, barColumn: { alignItems: "center", flex: 1, justifyContent: "flex-end" }, bar: { backgroundColor: "#3595DA", borderRadius: 7, minHeight: 4, width: 18 }, barLabel: { color: "#9AA5B1", fontSize: 10, marginTop: 7 }, modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, modeButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 18, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: 5, paddingVertical: 15 }, modeLabel: { color: "#425163", fontSize: 12, fontWeight: "800" }, activeCard: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 18, flexDirection: "row", padding: 15 }, activeCopy: { flex: 1, marginLeft: 10 }, activeTitle: { color: "#13202D", fontSize: 14, fontWeight: "800" }, activeText: { color: "#687586", fontSize: 12, marginTop: 2 }, pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] } });
