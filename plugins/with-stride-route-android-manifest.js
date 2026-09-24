const { withAndroidManifest, withAppBuildGradle } = require("@expo/config-plugins");

const BLOCKED_PERMISSIONS = new Set([
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
]);

function withManifestHygiene(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    manifest["uses-permission"] = (manifest["uses-permission"] || []).filter((entry) => {
      const name = entry?.$?.["android:name"];
      return !BLOCKED_PERMISSIONS.has(name);
    });

    const queries = manifest.queries || (manifest.queries = [{}]);
    const query = queries[0] || (queries[0] = {});
    const packages = query.package || (query.package = []);
    const healthConnectPackage = "com.google.android.apps.healthdata";
    if (!packages.some((entry) => entry?.$?.["android:name"] === healthConnectPackage)) {
      packages.push({ $: { "android:name": healthConnectPackage } });
    }

    const application = manifest.application?.[0];
    if (application) {
      application.$ = application.$ || {};
      application.$["android:allowBackup"] = "false";
    }

    return config;
  });
}

function patchReleaseSigning(contents) {
  if (contents.includes("STRIDEROUTE_RELEASE_SIGNING_BEGIN")) return contents;

  const projectRootLine = "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()";
  if (!contents.includes(projectRootLine)) {
    throw new Error("Unable to patch Android release signing: projectRoot marker not found.");
  }

  const signingHeader = `${projectRootLine}\n// STRIDEROUTE_RELEASE_SIGNING_BEGIN\ndef releaseKeystorePropertiesFile = new File(projectRoot, "signing/keystore.properties")\ndef releaseKeystoreProperties = new Properties()\nif (releaseKeystorePropertiesFile.exists()) {\n    releaseKeystorePropertiesFile.withInputStream { releaseKeystoreProperties.load(it) }\n}\ndef releaseKeystoreFile = new File(projectRoot, "signing/" + releaseKeystoreProperties.getProperty('storeFile', 'strideroute-upload.jks'))\ndef releaseSigningAvailable = releaseKeystorePropertiesFile.exists() && releaseKeystoreFile.exists()\n// PRIVATE signing is optional during CI. When the files exist, the same permanent upload key is used.\n// STRIDEROUTE_RELEASE_SIGNING_END`;
  contents = contents.replace(projectRootLine, signingHeader);

  const debugSigningBlock = `    signingConfigs {\n        debug {\n            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n    }`;
  const releaseSigningBlock = `    signingConfigs {\n        debug {\n            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n        release {\n            if (releaseSigningAvailable) {\n                storeFile releaseKeystoreFile\n                storePassword releaseKeystoreProperties['storePassword']\n                keyAlias releaseKeystoreProperties['keyAlias']\n                keyPassword releaseKeystoreProperties['keyPassword']\n            }\n        }\n    }`;

  if (!contents.includes(debugSigningBlock)) {
    throw new Error("Unable to patch Android release signing: signingConfigs marker not found.");
  }
  contents = contents.replace(debugSigningBlock, releaseSigningBlock);

  const releaseSigningPattern = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseSigningPattern.test(contents)) {
    throw new Error("Unable to patch Android release signing: release signing marker not found.");
  }
  contents = contents.replace(
    releaseSigningPattern,
    "$1if (releaseSigningAvailable) {\n                signingConfig signingConfigs.release\n            }",
  );
  return contents;
}


function patchReleaseOptimization(contents) {
  const optimized = 'getDefaultProguardFile("proguard-android-optimize.txt")';
  if (contents.includes(optimized)) return contents;

  const legacy = 'getDefaultProguardFile("proguard-android.txt")';
  if (!contents.includes(legacy)) {
    throw new Error("Unable to patch Android release optimization: ProGuard baseline marker not found.");
  }
  return contents.replace(legacy, optimized);
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("StrideRoute release signing plugin expects Groovy app/build.gradle.");
    }
    config.modResults.contents = patchReleaseSigning(config.modResults.contents);
    config.modResults.contents = patchReleaseOptimization(config.modResults.contents);
    return config;
  });
}

module.exports = function withStrideRouteAndroid(config) {
  config = withManifestHygiene(config);
  config = withReleaseSigning(config);
  return config;
};
