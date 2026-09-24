import { Platform } from "react-native";

import { dateKey } from "./math";
import type { HealthConnectState } from "./types";

const STEP_PERMISSION = { accessType: "read", recordType: "Steps" } as const;

async function healthConnectModule() {
  if (Platform.OS !== "android") return null;
  return (await import("react-native-health-connect")) as any;
}

export async function getHealthConnectState(): Promise<HealthConnectState> {
  if (Platform.OS !== "android") return "unavailable";
  try {
    const hc = await healthConnectModule();
    if (!hc) return "unavailable";
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return "unavailable";
    const initialized = await hc.initialize();
    if (!initialized) return "error";
    const granted = await hc.getGrantedPermissions();
    return granted.some((permission: any) => permission.accessType === "read" && permission.recordType === "Steps") ? "granted" : "available";
  } catch {
    return "error";
  }
}

export async function requestHealthConnectStepsPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const hc = await healthConnectModule();
    if (!hc) return false;
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return false;
    if (!await hc.initialize()) return false;
    const granted = await hc.requestPermission([STEP_PERMISSION]);
    return granted.some((permission: any) => permission.accessType === "read" && permission.recordType === "Steps");
  } catch {
    return false;
  }
}

function localDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function readHealthConnectDailySteps(days = 30) {
  if (Platform.OS !== "android") return [] as Array<{ dateKey: string; steps: number }>;
  const hc = await healthConnectModule();
  if (!hc || !await hc.initialize()) return [];
  const end = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  const results = await hc.aggregateGroupByPeriod({
    recordType: "Steps",
    timeRangeFilter: { operator: "between", startTime: localDateTime(start), endTime: localDateTime(end) },
    timeRangeSlicer: { period: "DAYS", length: 1 },
  });
  return (results as any[]).map((entry) => ({
    dateKey: typeof entry.startTime === "string" && /^\d{4}-\d{2}-\d{2}/.test(entry.startTime) ? entry.startTime.slice(0, 10) : dateKey(new Date(entry.startTime).getTime()),
    steps: Math.max(0, Math.round(Number(entry.result?.COUNT_TOTAL ?? 0))),
  }));
}

export async function readHealthConnectStepsBetween(startedAt: number, endedAt: number) {
  if (Platform.OS !== "android" || endedAt <= startedAt) return null;
  try {
    const hc = await healthConnectModule();
    if (!hc || !await hc.initialize()) return null;
    const result = await hc.aggregateRecord({
      recordType: "Steps",
      timeRangeFilter: { operator: "between", startTime: new Date(startedAt).toISOString(), endTime: new Date(endedAt).toISOString() },
    });
    const count = Number(result?.COUNT_TOTAL ?? 0);
    return Number.isFinite(count) ? Math.max(0, Math.round(count)) : null;
  } catch {
    return null;
  }
}

export async function openHealthConnectSettings() {
  if (Platform.OS !== "android") return false;
  try {
    const hc = await healthConnectModule();
    if (!hc) return false;
    await hc.openHealthConnectSettings();
    return true;
  } catch {
    return false;
  }
}
