import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { averagePaceSecondsPerKm, averageSpeedKmh, averageStepDistanceCm } from "./math";
import type { WorkoutSession } from "./types";

function isoDate(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function csvCell(value: string | number | null | undefined) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportWorkoutCsv(sessions: WorkoutSession[]) {
  const completed = sessions.filter((session) => session.status === "completed");
  if (!FileSystem.cacheDirectory) throw new Error("Cache directory unavailable");
  const headers = [
    "started_at", "ended_at", "type", "duration_seconds", "distance_meters", "steps",
    "average_pace_sec_per_km", "average_speed_kmh", "average_step_cm", "estimated_calories_kcal",
  ];
  const rows = completed.map((session) => {
    const pace = session.type === "bike" || session.type === "shopping" ? null : averagePaceSecondsPerKm(session.distanceMeters, session.durationSeconds);
    const speed = averageSpeedKmh(session.distanceMeters, session.durationSeconds);
    const stepCm = session.type === "bike" ? null : averageStepDistanceCm(session.distanceMeters, session.steps);
    return [
      isoDate(session.startedAt), session.endedAt ? isoDate(session.endedAt) : "", session.type,
      session.durationSeconds, Math.round(session.distanceMeters * 10) / 10, session.steps,
      pace == null ? "" : Math.round(pace * 10) / 10,
      speed == null ? "" : Math.round(speed * 100) / 100,
      stepCm == null ? "" : Math.round(stepCm * 10) / 10,
      session.estimatedCaloriesKcal ?? "",
    ].map(csvCell).join(",");
  });
  const content = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const fileName = `StrideRoute_workouts_${new Date().toISOString().slice(0, 10)}.csv`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (!await Sharing.isAvailableAsync()) throw new Error("Sharing unavailable");
  await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: fileName });
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function exportWorkoutGpx(session: WorkoutSession) {
  if (!FileSystem.cacheDirectory) throw new Error("Cache directory unavailable");
  if (session.route.length < 2) throw new Error("No route");
  const segments = new Map<number, typeof session.route>();
  for (const point of session.route) {
    const list = segments.get(point.segmentIndex) ?? [];
    list.push(point);
    segments.set(point.segmentIndex, list);
  }
  const trkSegs = [...segments.values()].map((points) => {
    const body = points.map((point) => {
      const ele = point.altitude != null && Number.isFinite(point.altitude) ? `<ele>${point.altitude.toFixed(2)}</ele>` : "";
      return `<trkpt lat="${point.latitude.toFixed(7)}" lon="${point.longitude.toFixed(7)}">${ele}<time>${new Date(point.timestamp).toISOString()}</time></trkpt>`;
    }).join("");
    return `<trkseg>${body}</trkseg>`;
  }).join("");
  const name = `StrideRoute ${session.type} ${new Date(session.startedAt).toISOString()}`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="StrideRoute" xmlns="http://www.topografix.com/GPX/1/1"><metadata><time>${new Date().toISOString()}</time></metadata><trk><name>${xmlEscape(name)}</name>${trkSegs}</trk></gpx>`;
  const fileName = `StrideRoute_${session.type}_${new Date(session.startedAt).toISOString().replace(/[:.]/g, "-")}.gpx`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (!await Sharing.isAvailableAsync()) throw new Error("Sharing unavailable");
  await Sharing.shareAsync(uri, { mimeType: "application/gpx+xml", dialogTitle: fileName });
}
