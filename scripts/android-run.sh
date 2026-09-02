#!/usr/bin/env bash
#
# Build the Capacitor Android app and install it on the attached device.
#
# The Android toolchain is not on PATH by default on this machine: the JDK and
# SDK come from Homebrew rather than Android Studio, so the locations below are
# the brew prefixes. Anything already exported in the environment wins, which is
# what lets an Android Studio install (~/Library/Android/sdk) drop in unchanged.
#
# Capacitor 7 requires JDK 21 — the system JDK is newer than AGP accepts, so
# JAVA_HOME is pinned rather than inherited.
#
# Usage:
#   scripts/android-run.sh            # build web + sync + assemble + install
#   scripts/android-run.sh --no-web   # skip the vite build, reuse dist/
set -euo pipefail

cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"

if [ "${1:-}" != "--no-web" ]; then
  npm run build:cap
fi

npx cap sync android

android/gradlew -p android assembleDebug

APK=android/app/build/outputs/apk/debug/app-debug.apk

if [ -z "$("$ADB" devices | sed '1d' | grep -w device || true)" ]; then
  echo
  echo "Built $APK, but no authorized device is attached."
  echo "Check: tablet awake, USB debugging on, and the 'Allow USB debugging' prompt accepted."
  echo "Then: $ADB install -r $APK"
  exit 1
fi

"$ADB" install -r "$APK"
"$ADB" shell monkey -p com.redstring.app -c android.intent.category.LAUNCHER 1 >/dev/null
echo "Installed and launched com.redstring.app"
