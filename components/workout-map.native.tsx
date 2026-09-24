import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Camera, GeoJSONSource, Layer, Map as MapView } from "@maplibre/maplibre-react-native";

import type { RoutePoint } from "@/lib/fitness/types";
import { useI18n } from "@/lib/i18n";

const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const emptyCollection = { type: "FeatureCollection", features: [] } as any;

function pointFeature(point: RoutePoint | undefined, label: string) {
  if (!point) return emptyCollection;
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: { label }, geometry: { type: "Point", coordinates: [point.longitude, point.latitude] } }] };
}

function sampleSegment(points: RoutePoint[], maxPoints = 500) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.min(points.length - 1, Math.round(index * step))]);
}

export function WorkoutMap({ route, fitRoute = false }: { route: RoutePoint[]; fitRoute?: boolean }) {
  const { t } = useI18n();
  const latestPoint = route.at(-1);
  const routeData = useMemo(() => {
    if (route.length < 2) return emptyCollection;
    const groups = new globalThis.Map<number, RoutePoint[]>();
    route.forEach((point) => groups.set(point.segmentIndex, [...(groups.get(point.segmentIndex) ?? []), point]));
    const coordinates = [...groups.values()].filter((points) => points.length >= 2).map((points) => sampleSegment(points).map((point) => [point.longitude, point.latitude]));
    if (!coordinates.length) return emptyCollection;
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates } }] };
  }, [route]);
  const startData = useMemo(() => pointFeature(route[0], t("map.start")), [route, t]);
  const latestData = useMemo(() => pointFeature(latestPoint, fitRoute ? t("map.end") : t("map.current")), [fitRoute, latestPoint, t]);
  const center = latestPoint ? [latestPoint.longitude, latestPoint.latitude] as [number, number] : undefined;
  const bounds = useMemo(() => {
    if (!fitRoute || route.length < 2) return null;
    const latitudes = route.map((point) => point.latitude);
    const longitudes = route.map((point) => point.longitude);
    return [
      Math.min(...longitudes),
      Math.min(...latitudes),
      Math.max(...longitudes),
      Math.max(...latitudes),
    ] as [number, number, number, number];
  }, [fitRoute, route]);

  return <View style={styles.container}>
    <MapView mapStyle={OPEN_FREE_MAP_STYLE} style={styles.map} attribution attributionPosition={{ bottom: 24, right: 6 }} logo={false} compass scaleBar>
      {bounds ? <Camera bounds={bounds} padding={{ top: 36, right: 36, bottom: 36, left: 36 }} /> : center ? <Camera center={center} zoom={15.5} /> : <Camera initialViewState={{ zoom: 1 }} />}
      <GeoJSONSource id="workout-route" data={routeData}>
        <Layer id="workout-route-outline" type="line" paint={{ "line-color": "#FFFFFF", "line-width": 8, "line-opacity": 0.9 }} layout={{ "line-cap": "round", "line-join": "round" }} />
        <Layer id="workout-route-line" type="line" paint={{ "line-color": "#1479FF", "line-width": 5 }} layout={{ "line-cap": "round", "line-join": "round" }} />
      </GeoJSONSource>
      <GeoJSONSource id="workout-start" data={startData}>
        <Layer id="workout-start-circle" type="circle" paint={{ "circle-radius": 7, "circle-color": "#21A36A", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 }} />
      </GeoJSONSource>
      <GeoJSONSource id="workout-latest" data={latestData}>
        <Layer id="workout-latest-circle" type="circle" paint={{ "circle-radius": 8, "circle-color": "#1479FF", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 }} />
      </GeoJSONSource>
    </MapView>
    <View pointerEvents="none" style={styles.attribution} accessibilityLabel={t("map.attributionLabel")}>
      <Text style={styles.attributionText}>© OpenFreeMap · © OpenMapTiles · © OpenStreetMap</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", borderRadius: 24, backgroundColor: "#EAF2FF" }, map: { flex: 1 },
  attribution: { backgroundColor: "rgba(255,255,255,0.9)", borderRadius: 6, bottom: 6, left: 6, paddingHorizontal: 6, paddingVertical: 3, position: "absolute" },
  attributionText: { color: "#425466", fontSize: 9, fontWeight: "600" },
});
