const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withStrideRouteWidget(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) throw new Error("StrideRoute Widget plugin 找不到 Android application 節點。");

    application.receiver = application.receiver || [];
    const receiverName = "expo.modules.stridewidget.StrideWidgetProvider";
    let receiver = application.receiver.find((entry) => entry?.$?.["android:name"] === receiverName);
    if (!receiver) {
      receiver = { $: { "android:name": receiverName, "android:exported": "true" } };
      application.receiver.push(receiver);
    }

    receiver["intent-filter"] = receiver["intent-filter"] || [];
    const ensureAction = (actionName) => {
      if (!receiver["intent-filter"].some((entry) => entry?.action?.some((action) => action?.$?.["android:name"] === actionName))) {
        receiver["intent-filter"].push({ action: [{ $: { "android:name": actionName } }] });
      }
    };
    ensureAction("android.appwidget.action.APPWIDGET_UPDATE");
    ensureAction("android.intent.action.USER_PRESENT");
    ensureAction("android.intent.action.BOOT_COMPLETED");

    receiver["meta-data"] = receiver["meta-data"] || [];
    if (!receiver["meta-data"].some((entry) => entry?.$?.["android:name"] === "android.appwidget.provider")) {
      receiver["meta-data"].push({
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": "@xml/stride_widget_info",
        },
      });
    }

    return config;
  });
};
