export type WorkoutStatus = "active" | "paused" | "completed";
export type WorkoutType = "walk" | "run" | "shopping" | "bike";
export type RoutePointSource = "foreground" | "background" | "initial";
export type DailyStepSource = "health_connect" | "sensor" | "legacy";
export type VoiceAnnouncementInterval = 5 | 10 | 15;

export type RoutePoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number | null;
  speed: number | null;
  altitude: number | null;
  segmentIndex: number;
  source: RoutePointSource;
};

export type WorkoutSession = {
  id: string;
  type: WorkoutType;
  startedAt: number;
  endedAt: number | null;
  pausedAt: number | null;
  pausedSeconds: number;
  durationSeconds: number;
  distanceMeters: number;
  steps: number;
  maxSpeedMps: number;
  currentSegmentIndex: number;
  route: RoutePoint[];
  previewRoute: RoutePoint[];
  status: WorkoutStatus;
  weightKgAtCompletion: number | null;
  estimatedCaloriesKcal: number | null;
};

export type AppSettings = {
  dailyStepGoal: number;
  backgroundTrackingEnabled: boolean;
  gpsRecommendationShown?: boolean;
  heightCm?: number | null;
  weightKg?: number | null;
  voiceAnnouncementsEnabled?: boolean;
  voiceAnnouncementIntervalMinutes?: VoiceAnnouncementInterval;
  autoUpdateCheckEnabled?: boolean;
};

export type DailyStepSnapshot = {
  dateKey: string;
  steps: number;
  source: DailyStepSource;
  updatedAt: number;
};

export type DailyStepHistory = Record<string, number>;

export type HealthConnectState = "unknown" | "available" | "granted" | "denied" | "unavailable" | "error";
