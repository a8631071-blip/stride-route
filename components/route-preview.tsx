import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import type { RoutePoint } from "@/lib/fitness/types";

type Drawing = {
  segments: string[];
  start: [number, number];
  end: [number, number];
};

export function RoutePreview({ route }: { route: RoutePoint[] }) {
  const drawing = useMemo<Drawing | null>(() => {
    if (route.length < 2) return null;
    const latitudes = route.map((point) => point.latitude);
    const longitudes = route.map((point) => point.longitude);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    const latSpan = Math.max(maxLat - minLat, 0.00001);
    const lngSpan = Math.max(maxLng - minLng, 0.00001);
    const project = (point: RoutePoint): [number, number] => [
      10 + ((point.longitude - minLng) / lngSpan) * 76,
      72 - ((point.latitude - minLat) / latSpan) * 60,
    ];

    const groups = new globalThis.Map<number, RoutePoint[]>();
    route.forEach((point) => groups.set(point.segmentIndex, [...(groups.get(point.segmentIndex) ?? []), point]));
    const segments = [...groups.values()]
      .filter((points) => points.length >= 2)
      .map((points) => points.map(project).map(([x, y]) => `${x},${y}`).join(" "));
    if (!segments.length) return null;
    return { segments, start: project(route[0]), end: project(route.at(-1)!) };
  }, [route]);

  return (
    <View style={styles.frame}>
      {drawing ? (
        <Svg width="100%" height="100%" viewBox="0 0 96 82">
          {drawing.segments.map((points, index) => (
            <Polyline key={`${index}-${points.slice(0, 12)}`} points={points} fill="none" stroke="#1479FF" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          <Circle cx={drawing.start[0]} cy={drawing.start[1]} r={4} fill="#21A36A" />
          <Circle cx={drawing.end[0]} cy={drawing.end[1]} r={4} fill="#1479FF" />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ frame: { width: 96, height: 82, borderRadius: 14, backgroundColor: "#EEF3F8", overflow: "hidden" } });
