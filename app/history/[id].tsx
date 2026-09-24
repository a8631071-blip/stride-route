import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { MetricCard } from "@/components/metric-card";
import { ScreenContainer } from "@/components/screen-container";
import { WorkoutMap } from "@/components/workout-map";
import { useFitness } from "@/lib/fitness/fitness-provider";
import { averageStepDistanceCm, formatDistance, formatDuration, formatPace, formatSpeed, formatSpeedMps } from "@/lib/fitness/math";
import { exportWorkoutGpx } from "@/lib/fitness/export";
import { useI18n } from "@/lib/i18n";
import type { WorkoutSession } from "@/lib/fitness/types";

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, locale, formatNumber, formatDate } = useI18n();
  const { deleteWorkout, loadWorkout } = useFitness();
  const [workout, setWorkout] = useState<WorkoutSession | null | undefined>(undefined);

  const goToHistory = useCallback(() => { router.replace("/(tabs)/history" as never); }, [router]);
  useEffect(() => { let active = true; void loadWorkout(id).then((result) => { if (active) setWorkout(result); }); return () => { active = false; }; }, [id, loadWorkout]);
  useEffect(() => { if (Platform.OS !== "android") return; const subscription = BackHandler.addEventListener("hardwareBackPress", () => { goToHistory(); return true; }); return () => subscription.remove(); }, [goToHistory]);

  if (workout === undefined) return <ScreenContainer className="items-center justify-center px-6"><ActivityIndicator size="large" color="#1479FF" /><Text style={styles.loading}>{t("detail.loading")}</Text></ScreenContainer>;
  if (!workout) return <ScreenContainer className="items-center justify-center px-6"><Text style={styles.notFound}>{t("detail.notFound")}</Text><Pressable onPress={goToHistory} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>{t("detail.back")}</Text></Pressable></ScreenContainer>;

  const bike = workout.type === "bike";
  const shopping = workout.type === "shopping";
  const confirmDelete = () => Alert.alert(t("detail.deleteTitle"), t("detail.deleteBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("detail.delete"), style: "destructive", onPress: async () => { await deleteWorkout(workout.id); goToHistory(); } }]);
  const workoutLabel = t(`workout.${workout.type}`);
  const startedDate = new Date(workout.startedAt);
  const endedDate = workout.endedAt ? new Date(workout.endedAt) : null;
  const crossesDay = Boolean(endedDate && (
    startedDate.getFullYear() !== endedDate.getFullYear()
    || startedDate.getMonth() !== endedDate.getMonth()
    || startedDate.getDate() !== endedDate.getDate()
  ));
  const averageStepCm = bike ? null : averageStepDistanceCm(workout.distanceMeters, workout.steps);
  const exportGpx = async () => {
    try { await exportWorkoutGpx(workout); } catch { Alert.alert(t("export.failedTitle"), workout.route.length < 2 ? t("export.noRoute") : t("export.failedBody")); }
  };
  const endTimeText = workout.endedAt
    ? formatDate(workout.endedAt, crossesDay
      ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
      : { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "—";

  return <ScreenContainer className="px-5" containerClassName="bg-background" edges={["top", "bottom", "left", "right"]}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.navigation}><Pressable onPress={goToHistory} style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}><MaterialIcons name="chevron-left" size={25} color="#13202D" /></Pressable><Pressable onPress={confirmDelete} style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={21} color="#E34B4B" /></Pressable></View>
    <Text style={styles.eyebrow}>{workoutLabel}</Text><Text style={styles.title}>{formatDate(workout.startedAt, { year: "numeric", month: "2-digit", day: "2-digit" })}</Text><Text style={styles.subtitle}>{formatDuration(workout.durationSeconds)}{bike ? "" : ` · ${formatNumber(workout.steps)} ${t("common.steps")}`}</Text>
    <View style={styles.timeCard}><View style={styles.timeRow}><Text style={styles.timeLabel}>{t("detail.date")}</Text><Text style={styles.timeValue}>{formatDate(workout.startedAt, { year: "numeric", month: "2-digit", day: "2-digit" })}</Text></View><View style={styles.timeDivider} /><View style={styles.timeRow}><Text style={styles.timeLabel}>{t("detail.startTime")}</Text><Text style={styles.timeValue}>{formatDate(workout.startedAt, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</Text></View><View style={styles.timeDivider} /><View style={styles.timeRow}><Text style={styles.timeLabel}>{t("detail.endTime")}</Text><Text style={styles.timeValue}>{endTimeText}</Text></View></View>
    <View style={styles.mapFrame}><WorkoutMap route={workout.route} fitRoute /></View>
    {shopping ? <View style={styles.distanceBlock}><Text style={styles.distanceLabel}>{t("detail.shoppingTime")}</Text><Text style={styles.distance}>{formatDuration(workout.durationSeconds)}</Text><Text style={styles.shoppingDistance}>{t("detail.movingDistance", { distance: formatDistance(workout.distanceMeters, locale) })}</Text></View> : <View style={styles.distanceBlock}><Text style={styles.distanceLabel}>{t("detail.distance")}</Text><Text style={styles.distance}>{formatDistance(workout.distanceMeters, locale)}</Text></View>}
    {!shopping ? <View style={styles.metrics}><MetricCard label={t("detail.workoutTime")} value={formatDuration(workout.durationSeconds)} /><View style={styles.gap} /><MetricCard label={bike ? t("detail.averageSpeed") : t("detail.averagePace")} value={bike ? formatSpeed(workout.distanceMeters, workout.durationSeconds) : formatPace(workout.distanceMeters, workout.durationSeconds)} accent="#1479FF" /></View> : <View style={styles.metrics}><MetricCard label={t("detail.distance")} value={formatDistance(workout.distanceMeters, locale)} /><View style={styles.gap} /><MetricCard label={t("common.steps")} value={formatNumber(workout.steps)} accent="#1479FF" /></View>}
    {bike ? <View style={styles.metrics}><MetricCard label={t("detail.maxSpeed")} value={formatSpeedMps(workout.maxSpeedMps)} accent="#21A36A" /><View style={styles.gap} /><MetricCard label={t("detail.estimatedCalories")} value={workout.estimatedCaloriesKcal == null ? "—" : `${formatNumber(workout.estimatedCaloriesKcal)} kcal`} accent="#E78A32" /></View> : <View style={styles.metrics}><MetricCard label={t("detail.averageStepDistance")} value={averageStepCm == null ? "—" : `${formatNumber(Math.round(averageStepCm))} cm`} accent="#21A36A" /><View style={styles.gap} /><MetricCard label={t("detail.estimatedCalories")} value={workout.estimatedCaloriesKcal == null ? "—" : `${formatNumber(workout.estimatedCaloriesKcal)} kcal`} accent="#E78A32" /></View>}
    {workout.route.length >= 2 ? <Pressable onPress={() => void exportGpx()} style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}><MaterialIcons name="file-download" size={19} color="#1479FF" /><Text style={styles.exportButtonText}>{t("export.gpx")}</Text></Pressable> : null}
    <View style={styles.routeNote}><MaterialIcons name="privacy-tip" size={19} color="#21A36A" /><Text style={styles.routeNoteText}>{t("detail.localOnly")}</Text></View>
  </ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create({ content: { paddingTop: 8, paddingBottom: 28, gap: 16 }, navigation: { flexDirection: "row", justifyContent: "space-between" }, navButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 18, borderWidth: 1, height: 42, justifyContent: "center", width: 42 }, eyebrow: { color: "#21A36A", fontSize: 13, fontWeight: "800", letterSpacing: 1, marginTop: 5 }, title: { color: "#13202D", fontSize: 26, fontWeight: "800", marginTop: 2 }, subtitle: { color: "#687586", fontSize: 14, fontWeight: "600", marginTop: 5 }, timeCard: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 18, borderWidth: 1, overflow: "hidden" }, timeRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 14 }, timeLabel: { color: "#687586", fontSize: 12, fontWeight: "700" }, timeValue: { color: "#13202D", fontSize: 13, fontWeight: "800" }, timeDivider: { backgroundColor: "#EEF1F5", height: 1, marginLeft: 14 }, mapFrame: { height: 260, marginTop: 4 }, distanceBlock: { alignItems: "center", backgroundColor: "#13202D", borderRadius: 24, paddingVertical: 18 }, distanceLabel: { color: "#AAB8C7", fontSize: 13, fontWeight: "700" }, distance: { color: "#FFFFFF", fontSize: 34, fontWeight: "800", marginTop: 2 }, shoppingDistance: { color: "#BFD9FF", fontSize: 13, fontWeight: "700", marginTop: 4 }, metrics: { flexDirection: "row" }, gap: { width: 12 }, exportButton: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 16, flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 13 }, exportButtonText: { color: "#1479FF", fontSize: 13, fontWeight: "800" }, routeNote: { alignItems: "center", backgroundColor: "#F0FBF6", borderRadius: 17, flexDirection: "row", gap: 9, padding: 14 }, routeNoteText: { color: "#467664", flex: 1, fontSize: 12, fontWeight: "600", lineHeight: 18 }, loading: { color: "#687586", fontSize: 13, marginTop: 12 }, notFound: { color: "#13202D", fontSize: 17, fontWeight: "700" }, backButton: { backgroundColor: "#1479FF", borderRadius: 14, marginTop: 16, paddingHorizontal: 16, paddingVertical: 12 }, backText: { color: "#FFFFFF", fontWeight: "800" }, pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] } });
