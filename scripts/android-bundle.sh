#!/usr/bin/env bash
#
# Build the Android App Bundle (.aab) for Google Play, signed with the upload
# key (see the top of android/app/build.gradle for where the key is read from).
# Its version comes from package.json, via scripts/bump-version.js.
#
# The toolchain paths match scripts/android-run.sh: Homebrew's JDK 21 and SDK
# unless the environment already says otherwise.
#
# Usage:
#   scripts/android-bundle.sh            # build web + sync + bundle
#   scripts/android-bundle.sh --no-web   # skip the vite build, reuse dist/
set -euo pipefail

cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [ "${1:-}" != "--no-web" ]; then
  npm run build:cap
fi

npx cap sync android

(cd android && ./gradlew bundleRelease)

AAB="android/app/build/outputs/bundle/release/app-release.aab"
VERSION=$(node -p "require('./package.json').version")
echo "Built $AAB (Redstring $VERSION). Upload it in Play Console."
