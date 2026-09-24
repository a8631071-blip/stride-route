# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# StrideRoute V26: expo-sqlite / Expo Modules Record reflection-conversion safety under R8.
-keep interface expo.modules.kotlin.records.Record
-keep class expo.modules.kotlin.records.** { *; }
-keep class * implements expo.modules.kotlin.records.Record { *; }
-keep class expo.modules.sqlite.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
