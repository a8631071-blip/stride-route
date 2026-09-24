import { useRouter } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { RoutePreview } from "@/components/route-preview";
import { ScreenContainer } from "@/components/screen-container";
import { useFitness } from "@/lib/fitness/fitness-provider";
import { formatDistance, formatDuration, formatPace, formatSpeed } from "@/lib/fitness/math";
import { exportWorkoutCsv } from "@/lib/fitness/export";
import { useI18n } from "@/lib/i18n";
import type { WorkoutSession } from "@/lib/fitness/types";

export default function HistoryScreen() {
  const router = useRouter();
  const { sessions } = useFitness();
  const { t, locale, formatNumber, formatDate } = useI18n();
  const completedSessions = sessions.filter((session) => session.status === "completed");
  const workoutLabel = (type: WorkoutSession["type"]) => t(`workout.${type}`);
  const dateLabel = (timestamp: number) => formatDate(timestamp, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const exportCsv = async () => { try { await exportWorkoutCsv(completedSessions); } catch { Alert.alert(t("export.failedTitle"), t("export.failedBody")); } };

  const renderItem = ({ item }: { item: WorkoutSession }) => {
    const bike = item.type === "bike";
    const shopping = item.type === "shopping";
    return <Pressable onPress={() => router.push(`/history/${item.id}`)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <RoutePreview route={item.previewRoute} />
      <View style={styles.cardBody}>
        <View style={styles.typeRow}><MaterialIcons name={bike ? "directions-bike" : shopping ? "shopping-bag" : item.type === "run" ? "directions-run" : "directions-walk"} size={17} color="#7D8996" /><Text style={styles.cardDate}>{dateLabel(item.startedAt)}</Text></View>
        <View style={styles.distanceRow}><Text style={styles.distance}>{formatDistance(item.distanceMeters, locale)}</Text><Text style={styles.unitType}>{workoutLabel(item.type)}</Text></View>
        <Text style={styles.cardMeta}>{formatDuration(item.durationSeconds)}　{bike ? formatSpeed(item.distanceMeters, item.durationSeconds) : shopping ? `${formatDistance(item.distanceMeters, locale)}　${formatNumber(item.steps)} ${t("common.steps")}` : `${formatPace(item.distanceMeters, item.durationSeconds)}　${formatNumber(item.steps)} ${t("common.steps")}`}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color="#B0BAC5" />
    </Pressable>;
  };

  return <ScreenContainer className="px-5" containerClassName="bg-background"><FlatList
    data={completedSessions}
    renderItem={renderItem}
    keyExtractor={(item) => item.id}
    contentContainerStyle={completedSessions.length ? styles.listContent : styles.emptyContent}
    showsVerticalScrollIndicator={false}
    ListHeaderComponent={<View style={styles.header}><View style={styles.headerRow}><View><Text style={styles.eyebrow}>{t("history.eyebrow")}</Text><Text style={styles.title}>{t("history.title")}</Text></View>{completedSessions.length ? <Pressable onPress={() => void exportCsv()} style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}><MaterialIcons name="file-download" size={18} color="#1479FF" /><Text style={styles.exportButtonText}>{t("export.csv")}</Text></Pressable> : null}</View><Text style={styles.subtitle}>{t("history.subtitle")}</Text></View>}
    ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name="history" size={32} color="#1479FF" /></View><Text style={styles.emptyTitle}>{t("history.emptyTitle")}</Text><Text style={styles.emptyText}>{t("history.emptyText")}</Text><Pressable onPress={() => router.push("/(tabs)/workout" as never)} style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}><Text style={styles.emptyButtonText}>{t("history.start")}</Text></Pressable></View>}
  /></ScreenContainer>;
}

const styles = StyleSheet.create({
  listContent: { paddingTop: 14, paddingBottom: 32, gap: 12 }, emptyContent: { flexGrow: 1, paddingBottom: 32 },
  header: { paddingTop: 14, paddingBottom: 18 }, headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, exportButton: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 13, flexDirection: "row", gap: 5, paddingHorizontal: 11, paddingVertical: 9 }, exportButtonText: { color: "#1479FF", fontSize: 12, fontWeight: "800" }, eyebrow: { color: "#1479FF", fontSize: 13, fontWeight: "800", letterSpacing: 1 }, title: { color: "#13202D", fontSize: 26, fontWeight: "800", marginTop: 3 }, subtitle: { color: "#687586", fontSize: 14, lineHeight: 20, marginTop: 7 },
  card: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E7EBF0", borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 }, cardBody: { flex: 1 }, typeRow: { alignItems: "center", flexDirection: "row", gap: 6 }, cardDate: { color: "#7D8996", fontSize: 11, fontWeight: "600" }, distanceRow: { alignItems: "baseline", flexDirection: "row", gap: 7, marginTop: 5 }, distance: { color: "#3595DA", fontSize: 25, fontWeight: "800" }, unitType: { color: "#687586", fontSize: 12, fontWeight: "700" }, cardMeta: { color: "#8995A3", fontSize: 11, marginTop: 5 },
  empty: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 30 }, emptyIcon: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 25, height: 80, justifyContent: "center", width: 80 }, emptyTitle: { color: "#13202D", fontSize: 20, fontWeight: "800", marginTop: 18 }, emptyText: { color: "#687586", fontSize: 14, lineHeight: 21, marginTop: 7, textAlign: "center" }, emptyButton: { backgroundColor: "#1479FF", borderRadius: 14, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 }, emptyButtonText: { color: "#FFFFFF", fontWeight: "800" }, pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
