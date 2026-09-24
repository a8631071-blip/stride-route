import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useI18n } from "@/lib/i18n";

export function StepProgress({ steps, goal }: { steps: number | null; goal: number }) {
  const { t, formatNumber } = useI18n();
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const ratio = steps === null ? 0 : Math.min(steps / goal, 1);
  return <View style={styles.wrapper}><Svg width={184} height={184} viewBox="0 0 184 184" style={styles.svg}><Circle cx={92} cy={92} r={radius} stroke="#E5EDF8" strokeWidth={13} fill="none" /><Circle cx={92} cy={92} r={radius} stroke="#1479FF" strokeWidth={13} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - ratio)} transform="rotate(-90 92 92)" /></Svg><View style={styles.content}><Text style={styles.value}>{steps === null ? "—" : formatNumber(steps)}</Text><Text style={styles.label}>{t("today.stepLabel")}</Text></View></View>;
}
const styles = StyleSheet.create({ wrapper: { height: 184, width: 184, alignSelf: "center", justifyContent: "center", alignItems: "center" }, svg: { position: "absolute" }, content: { alignItems: "center" }, value: { color: "#13202D", fontSize: 32, fontWeight: "800", letterSpacing: -1.1 }, label: { color: "#687586", fontSize: 13, fontWeight: "600", marginTop: 2 } });
