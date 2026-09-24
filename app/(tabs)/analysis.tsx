import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useFitness } from "@/lib/fitness/fitness-provider";
import { averagePaceSecondsPerKm, averageSpeedKmh, dateKey, formatDistance, formatDuration } from "@/lib/fitness/math";
import { useI18n } from "@/lib/i18n";
import type { WorkoutSession } from "@/lib/fitness/types";

type Period = "7d" | "30d" | "6m" | "1y";

function buildDailyDays(days: number, history: Record<string, number>, todaySteps: number) {
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (days - 1 - index));
    const key = dateKey(d.getTime());
    return { key, date: d, steps: key === dateKey() ? todaySteps : history[key] ?? 0 };
  });
}
function buildMonthly(months: number, history: Record<string, number>, todaySteps: number) {
  const items = Array.from({ length: months }, (_, index) => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() - (months - 1 - index));
    return { year: d.getFullYear(), month: d.getMonth(), date: d, steps: 0 };
  });
  const merged = { ...history, [dateKey()]: todaySteps };
  Object.entries(merged).forEach(([key, steps]) => {
    const d = new Date(`${key}T12:00:00`); const item = items.find((x) => x.year === d.getFullYear() && x.month === d.getMonth()); if (item) item.steps += steps;
  });
  return items.map((x) => ({ key: `${x.year}-${x.month}`, date: x.date, steps: x.steps }));
}
function calendarDaysInPeriod(period: Period) {
  if (period === "7d") return 7; if (period === "30d") return 30;
  const now = new Date(); now.setHours(12, 0, 0, 0); const start = new Date(now); start.setDate(1); start.setMonth(start.getMonth() - (period === "6m" ? 5 : 11));
  return Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
}
function periodStart(period: Period) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  else { d.setDate(1); d.setMonth(d.getMonth() - (period === "6m" ? 5 : 11)); }
  return d.getTime();
}
function longest(sessions: WorkoutSession[], type: WorkoutSession["type"]) { return sessions.filter((s) => s.type === type).sort((a,b) => b.distanceMeters - a.distanceMeters)[0] ?? null; }
function fastestPace(sessions: WorkoutSession[], type: "walk" | "run") {
  return sessions.filter((s) => s.type === type && s.distanceMeters >= 500).map((s) => ({ s, pace: averagePaceSecondsPerKm(s.distanceMeters, s.durationSeconds) })).filter((x): x is { s: WorkoutSession; pace: number } => x.pace != null).sort((a,b) => a.pace - b.pace)[0] ?? null;
}

export default function AnalysisScreen() {
  const { dailySteps, stepHistory, sessions } = useFitness();
  const { t, locale, formatNumber, formatDate } = useI18n();
  const [period, setPeriod] = useState<Period>("7d");
  const periods: Array<{ key: Period; label: string }> = [
    { key: "7d", label: t("analysis.7d") }, { key: "30d", label: t("analysis.30d") }, { key: "6m", label: t("analysis.6m") }, { key: "1y", label: t("analysis.1y") },
  ];
  const data = useMemo(() => period === "7d" ? buildDailyDays(7, stepHistory, dailySteps ?? 0) : period === "30d" ? buildDailyDays(30, stepHistory, dailySteps ?? 0) : period === "6m" ? buildMonthly(6, stepHistory, dailySteps ?? 0) : buildMonthly(12, stepHistory, dailySteps ?? 0), [dailySteps, period, stepHistory]);
  const total = data.reduce((sum, item) => sum + item.steps, 0); const average = Math.round(total / Math.max(1, calendarDaysInPeriod(period))); const max = Math.max(1, ...data.map((item) => item.steps));
  const visible = period === "30d" ? data.filter((_, index) => index % 3 === 0 || index === data.length - 1) : data;
  const labelFor = (date: Date) => period === "6m" || period === "1y" ? formatDate(date, { month: "short" }) : `${date.getMonth() + 1}/${date.getDate()}`;
  const completed = sessions.filter((s) => s.status === "completed");
  const selected = completed.filter((s) => s.startedAt >= periodStart(period));
  const selectedDistance = selected.reduce((sum, s) => sum + s.distanceMeters, 0); const selectedSeconds = selected.reduce((sum, s) => sum + s.durationSeconds, 0); const selectedCalories = selected.reduce((sum, s) => sum + (s.estimatedCaloriesKcal ?? 0), 0);
  const dailyEntries = { ...stepHistory, [dateKey()]: dailySteps ?? 0 }; const bestDaily = Object.entries(dailyEntries).sort((a,b) => b[1] - a[1])[0];
  const longWalk = longest(completed, "walk"); const longRun = longest(completed, "run"); const longBike = longest(completed, "bike"); const fastWalk = fastestPace(completed, "walk"); const fastRun = fastestPace(completed, "run");
  const longestShopping = completed.filter((s) => s.type === "shopping").sort((a,b) => b.durationSeconds - a.durationSeconds)[0] ?? null;
  const longestWorkout = [...completed].sort((a,b) => b.durationSeconds - a.durationSeconds)[0] ?? null;
  const fastestBike = completed.filter((s) => s.type === "bike" && s.distanceMeters >= 500 && s.durationSeconds > 0).map((s) => ({ s, speed: averageSpeedKmh(s.distanceMeters, s.durationSeconds) ?? 0 })).sort((a,b) => b.speed - a.speed)[0] ?? null;
  const paceText = (seconds: number | null | undefined) => { if (seconds == null) return "—"; const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)}'${String(rounded % 60).padStart(2, "0")}"/km`; };
  const bestItems = [
    [t("analysis.bestDailySteps"), bestDaily ? `${formatNumber(bestDaily[1])} ${t("common.steps")}` : "—"],
    [t("analysis.longestWalk"), longWalk ? formatDistance(longWalk.distanceMeters, locale) : "—"],
    [t("analysis.fastestWalkPace"), paceText(fastWalk?.pace)],
    [t("analysis.longestRun"), longRun ? formatDistance(longRun.distanceMeters, locale) : "—"],
    [t("analysis.fastestRunPace"), paceText(fastRun?.pace)],
    [t("analysis.longestRide"), longBike ? formatDistance(longBike.distanceMeters, locale) : "—"],
    [t("analysis.longestShopping"), longestShopping ? formatDuration(longestShopping.durationSeconds) : "—"],
    [t("analysis.fastestBikeSpeed"), fastestBike?.speed ? `${fastestBike.speed.toFixed(1)} km/h` : "—"],
    [t("analysis.longestWorkout"), longestWorkout ? formatDuration(longestWorkout.durationSeconds) : "—"],
  ];
  return <ScreenContainer className="px-5" containerClassName="bg-background"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Text style={styles.eyebrow}>{t("analysis.eyebrow")}</Text><Text style={styles.title}>{t("analysis.title")}</Text>
    <View style={styles.segment}>{periods.map((item) => <Pressable key={item.key} onPress={() => setPeriod(item.key)} style={[styles.segmentButton, period === item.key && styles.segmentActive]}><Text style={[styles.segmentText, period === item.key && styles.segmentTextActive]}>{item.label}</Text></Pressable>)}</View>
    <View style={styles.summary}><View><Text style={styles.summaryLabel}>{t("analysis.dailyAverage")}</Text><Text style={styles.summaryValue}>{formatNumber(average)}</Text></View><View><Text style={styles.summaryLabel}>{t("analysis.total")}</Text><Text style={styles.summaryValue}>{formatNumber(total)}</Text></View></View>
    <View style={styles.chartCard}><View style={styles.chart}>{data.map((item) => <View key={item.key} style={styles.barColumn}><View style={[styles.bar, { height: Math.max(3, Math.round((item.steps / max) * 170)) }]} />{period !== "30d" || visible.some((value) => value.key === item.key) ? <Text style={styles.barLabel}>{labelFor(item.date)}</Text> : <View style={{ height: 14 }} />}</View>)}</View></View>
    <Text style={styles.note}>{t("analysis.note")}</Text>
    <Text style={styles.sectionTitle}>{t("analysis.workoutSummary")}</Text><View style={styles.grid}>
      <Stat label={t("analysis.workoutCount")} value={formatNumber(selected.length)} /><Stat label={t("analysis.workoutTime")} value={formatDuration(selectedSeconds)} /><Stat label={t("analysis.workoutDistance")} value={formatDistance(selectedDistance, locale)} /><Stat label={t("analysis.estimatedCalories")} value={selectedCalories ? `${formatNumber(selectedCalories)} kcal` : "—"} />
    </View>
    <Text style={styles.sectionTitle}>{t("analysis.personalBest")}</Text><View style={styles.grid}>{bestItems.map(([label,value]) => <Stat key={label} label={label} value={value} />)}</View>
  </ScrollView></ScreenContainer>;
}
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 34, gap: 16 }, eyebrow: { color: "#1479FF", fontSize: 13, fontWeight: "800", letterSpacing: 1 }, title: { color: "#13202D", fontSize: 28, fontWeight: "800", marginTop: -8 },
  segment: { borderColor: "#3595DA", borderRadius: 14, borderWidth: 1, flexDirection: "row", overflow: "hidden" }, segmentButton: { alignItems: "center", flex: 1, paddingVertical: 10 }, segmentActive: { backgroundColor: "#3595DA" }, segmentText: { color: "#3595DA", fontSize: 13, fontWeight: "800" }, segmentTextActive: { color: "#FFFFFF" },
  summary: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10 }, summaryLabel: { color: "#687586", fontSize: 14, textAlign: "center" }, summaryValue: { color: "#3595DA", fontSize: 34, fontWeight: "700", marginTop: 4, textAlign: "center" },
  chartCard: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 22, borderWidth: 1, padding: 14 }, chart: { alignItems: "flex-end", flexDirection: "row", height: 205 }, barColumn: { alignItems: "center", flex: 1, justifyContent: "flex-end", minWidth: 7 }, bar: { backgroundColor: "#3595DA", borderRadius: 5, maxWidth: 20, width: "70%" }, barLabel: { color: "#9AA5B1", fontSize: 8, marginTop: 5, transform: [{ rotate: "-35deg" }] }, note: { color: "#7B8795", fontSize: 12, lineHeight: 18 },
  sectionTitle: { color: "#687586", fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginTop: 4, textTransform: "uppercase" }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, statCard: { backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 18, borderWidth: 1, minHeight: 84, padding: 14, width: "48%" }, statLabel: { color: "#687586", fontSize: 11, fontWeight: "700" }, statValue: { color: "#13202D", fontSize: 18, fontWeight: "800", marginTop: 8 },
});
