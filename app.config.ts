import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "步跡",
  slug: "stride-route",
  version: "3.2.7",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "strideroute",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.app.strideroute",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.app.strideroute",
    versionCode: 22,
    allowBackup: false,
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/icon.png",
      backgroundImage: "./assets/images/icon.png",
      monochromeImage: "./assets/images/icon.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.ACTIVITY_RECOGNITION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.health.READ_STEPS",
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/icon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-location",
      {
        locationWhenInUsePermission: "允許步跡在你主動開始健行、跑步、逛街或自行車時使用精確位置，以記錄 GPS 路線與距離。",
        locationAlwaysAndWhenInUsePermission: "允許步跡只在運動進行中於背景持續使用位置。切換其他 App 或鎖定螢幕後仍會記錄 GPS 路線與距離；暫停或結束運動後即停止背景路線記錄。",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    "@maplibre/maplibre-react-native",
    "react-native-health-connect",
    "./plugins/with-stride-route-android-manifest",
    "./plugins/with-stride-route-widget",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: { backgroundColor: "#000000" },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          extraProguardRules: `
# StrideRoute V26: keep R8/resource shrinking enabled, but preserve Expo Modules
# record metadata/classes used by expo-sqlite to convert JS option maps into
# OpenDatabaseOptions at NativeDatabase construction time.
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep interface expo.modules.kotlin.records.Record
-keep class expo.modules.kotlin.records.** { *; }
-keep class * implements expo.modules.kotlin.records.Record { *; }
-keep class expo.modules.sqlite.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
`,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
