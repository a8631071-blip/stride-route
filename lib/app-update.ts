import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform } from "react-native";
import DeviceInfo from "react-native-device-info";

export type UpdateCheckResult = "unsupported" | "none" | "available" | "started" | "downloaded" | "in_progress" | "canceled" | "error";

const DOWNLOADED_KEY = "stride-route.v10.play-update-downloaded";
const CANCELED_KEY = "stride-route.v10.play-update-canceled";
const ERROR_KEY = "stride-route.v10.play-update-error";
let removeStatusListener: (() => void) | null = null;
let removeIntentListener: (() => void) | null = null;
let downloaded = false;

export function getCurrentAppVersion() {
  return DeviceInfo.getVersion();
}

export function getCurrentBuildNumber() {
  return DeviceInfo.getBuildNumber();
}

export async function openGooglePlayUpdatePage() {
  if (Platform.OS !== "android") return false;
  const packageName = "com.app.strideroute";
  const marketUrl = `market://details?id=${packageName}`;
  const webUrl = `https://play.google.com/store/apps/details?id=${packageName}`;
  try {
    await Linking.openURL(marketUrl);
    return true;
  } catch {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
}

async function rememberDownloaded(value: boolean) {
  downloaded = value;
  if (value) await AsyncStorage.setItem(DOWNLOADED_KEY, "1").catch(() => undefined);
  else await AsyncStorage.removeItem(DOWNLOADED_KEY).catch(() => undefined);
}

async function hasDownloadedUpdate() {
  if (downloaded) return true;
  downloaded = (await AsyncStorage.getItem(DOWNLOADED_KEY).catch(() => null)) === "1";
  return downloaded;
}

async function rememberCanceled(value: boolean) {
  if (value) await AsyncStorage.setItem(CANCELED_KEY, "1").catch(() => undefined);
  else await AsyncStorage.removeItem(CANCELED_KEY).catch(() => undefined);
}

async function hasCanceledUpdate() {
  return (await AsyncStorage.getItem(CANCELED_KEY).catch(() => null)) === "1";
}

async function rememberUpdateError(value: boolean) {
  if (value) await AsyncStorage.setItem(ERROR_KEY, "1").catch(() => undefined);
  else await AsyncStorage.removeItem(ERROR_KEY).catch(() => undefined);
}

async function consumeUpdateError() {
  const value = (await AsyncStorage.getItem(ERROR_KEY).catch(() => null)) === "1";
  if (value) await rememberUpdateError(false);
  return value;
}

function installStatusValue(module: any, name: string, fallback: number) {
  return module.IAUInstallStatus?.[name] ?? module.AndroidInstallStatus?.[name] ?? fallback;
}

function availabilityValue(module: any, name: string, fallback: number) {
  return module.IAUAvailabilityStatus?.[name] ?? module.AndroidAvailabilityStatus?.[name] ?? fallback;
}

function clearUpdateListeners() {
  removeStatusListener?.();
  removeIntentListener?.();
  removeStatusListener = null;
  removeIntentListener = null;
}

function attachUpdateListeners(module: any, inAppUpdates: any) {
  clearUpdateListeners();
  const downloadedStatus = installStatusValue(module, "DOWNLOADED", 11);
  const canceledStatus = installStatusValue(module, "CANCELED", 6);
  const pendingStatus = installStatusValue(module, "PENDING", 1);
  const downloadingStatus = installStatusValue(module, "DOWNLOADING", 2);
  const installingStatus = installStatusValue(module, "INSTALLING", 3);
  const installedStatus = installStatusValue(module, "INSTALLED", 4);
  const failedStatus = installStatusValue(module, "FAILED", 5);
  const unknownStatus = installStatusValue(module, "UNKNOWN", 0);

  const statusListener = (event: { status?: number }) => {
    const status = Number(event.status);
    if (status === pendingStatus || status === downloadingStatus || status === installingStatus) return;

    if (status === installedStatus) {
      void Promise.all([rememberDownloaded(false), rememberCanceled(false), rememberUpdateError(false)]).finally(clearUpdateListeners);
      return;
    }

    if (status === downloadedStatus) {
      void (async () => {
        await rememberDownloaded(true);
        try {
          // installUpdate() is void; keep the downloaded marker/listeners until a real
          // INSTALLED/CANCELED/FAILED state arrives instead of declaring success here.
          inAppUpdates.installUpdate();
        } catch {
          await rememberUpdateError(true);
        }
      })();
      return;
    }

    if (status === canceledStatus) {
      void Promise.all([rememberDownloaded(false), rememberCanceled(true)]).finally(clearUpdateListeners);
      return;
    }

    if (status === failedStatus || status === unknownStatus) {
      void rememberUpdateError(true).finally(clearUpdateListeners);
    }
  };

  const intentListener = (result: unknown) => {
    const status = Number(result);
    // The native wrapper uses the activity result primarily to report whether the
    // Play update UI was accepted/canceled. RESULT_OK is encoded as INSTALLED even
    // for a flexible update before download/install is actually complete, so only
    // CANCELED is authoritative here. Actual installation completion is taken from
    // the install-status listener above.
    if (status === canceledStatus) {
      void Promise.all([rememberDownloaded(false), rememberCanceled(true)]).finally(clearUpdateListeners);
    }
  };

  inAppUpdates.addStatusUpdateListener(statusListener);
  inAppUpdates.addIntentSelectionListener(intentListener);
  removeStatusListener = () => inAppUpdates.removeStatusUpdateListener(statusListener);
  removeIntentListener = () => inAppUpdates.removeIntentSelectionListener(intentListener);
}

export async function installDownloadedPlayUpdate(): Promise<UpdateCheckResult> {
  if (Platform.OS !== "android") return "unsupported";
  if (!await hasDownloadedUpdate()) return "none";
  try {
    const module = await import("sp-react-native-in-app-updates");
    const inAppUpdates = new module.default(false);
    const currentBuild = Number(DeviceInfo.getBuildNumber());
    const result = await inAppUpdates.checkNeedsUpdate({ curVersion: DeviceInfo.getBuildNumber() });
    const other = result?.other;
    const availability = other && "updateAvailability" in other ? other.updateAvailability : undefined;
    const storeBuild = Number(other && "versionCode" in other ? other.versionCode : undefined);
    const hasNewerBuild = Number.isFinite(storeBuild) && storeBuild > currentBuild;
    const inProgressStatus = availabilityValue(module, "DEVELOPER_TRIGGERED", 3);

    // A downloaded marker may survive the app process restart caused by a successful
    // update. If this build is no longer older and Play does not report an update in
    // progress, the marker is stale and must not trigger completeUpdate() again.
    if (!hasNewerBuild && availability !== inProgressStatus) {
      await rememberDownloaded(false);
      return "none";
    }

    attachUpdateListeners(module, inAppUpdates);
    inAppUpdates.installUpdate();
    return "downloaded";
  } catch {
    await rememberUpdateError(true);
    clearUpdateListeners();
    return "error";
  }
}

export async function checkForPlayUpdate(startIfAvailable = true): Promise<UpdateCheckResult> {
  if (Platform.OS !== "android") return "unsupported";
  if (await consumeUpdateError()) return "error";
  try {
    const module = await import("sp-react-native-in-app-updates");
    const SpInAppUpdates = module.default;
    const inAppUpdates = new SpInAppUpdates(false);
    const currentBuild = Number(DeviceInfo.getBuildNumber());
    const result = await inAppUpdates.checkNeedsUpdate({ curVersion: DeviceInfo.getBuildNumber() });
    const other = result?.other;
    const availability = other && "updateAvailability" in other ? other.updateAvailability : undefined;
    const storeBuild = Number(other && "versionCode" in other ? other.versionCode : undefined);
    const hasNewerBuild = Number.isFinite(storeBuild) && storeBuild > currentBuild;
    const availableStatus = availabilityValue(module, "AVAILABLE", 2);
    const unavailableStatus = availabilityValue(module, "UNAVAILABLE", 1);
    const inProgressStatus = availabilityValue(module, "DEVELOPER_TRIGGERED", 3);
    const unknownStatus = availabilityValue(module, "UNKNOWN", 0);
    const updateAvailable = availability === availableStatus || (result?.shouldUpdate === true && hasNewerBuild);
    const inProgress = availability === inProgressStatus;
    let alreadyDownloaded = await hasDownloadedUpdate();

    // Clear a stale marker after the app has actually advanced to the store build.
    if (alreadyDownloaded && !hasNewerBuild && !inProgress) {
      await rememberDownloaded(false);
      alreadyDownloaded = false;
    }
    if (alreadyDownloaded) {
      return startIfAvailable ? installDownloadedPlayUpdate() : "downloaded";
    }
    if (inProgress) return "in_progress";
    if (await hasCanceledUpdate()) {
      await rememberCanceled(false);
      return "canceled";
    }
    if (availability === unknownStatus || (availability == null && !result?.shouldUpdate)) return "error";
    if (availability === unavailableStatus && !hasNewerBuild) return "none";
    if (!updateAvailable) return "error";
    if (!startIfAvailable) return "available";

    attachUpdateListeners(module, inAppUpdates);
    try {
      await inAppUpdates.startUpdate({ updateType: module.IAUUpdateKind.FLEXIBLE });
      return "started";
    } catch {
      clearUpdateListeners();
      return "error";
    }
  } catch {
    clearUpdateListeners();
    return "error";
  }
}
