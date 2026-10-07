# Apple's on-device model

Apple's on-device language model (FoundationModels) for Redstring: the Druid
uses it as its mind, and the Wizard can chat on it (provider `apple`, chat only:
the model's 4,096-token window can't hold the Wizard's tools). It needs macOS 26
or iOS 26 on an Apple Intelligence device, with Apple Intelligence turned on.

One Swift core, two ways in:

| | What | Built by |
|---|---|---|
| `Sources/AFMCore/AppleModelCore.swift` | the request protocol: `health`, `prewarm`, `complete` (with an optional answer schema, enforced by guided generation), sessions, `end` | both |
| `Sources/afm-bridge/main.swift` | the Mac helper: one JSON object per line over stdio, no network listener. The desktop app spawns it (`electron/druidBridge.cjs`) | `swift build -c release --package-path native/afm-bridge` |
| `ios/Sources/AppleModelPlugin/` | the iPhone and iPad plugin, `AppleModel.send({ request })` from JavaScript | CocoaPods, through Capacitor (`RedstringAppleModel.podspec`; this folder is the `@redstring/apple-model` dev dependency, so `npx cap sync ios` wires it in) |

JavaScript reaches either one through `src/services/appleModel.js`.

```bash
swift build -c release --package-path native/afm-bridge
npm run druid -- --mind afm        # the Druid, headless, on Apple's model
```

The release workflow builds the helper on the macOS runner and ships it in the
app's Resources (`electron-builder.json` `extraResources`), signed and
notarized with the app. It is Apple silicon only, as the model is.

`health` reports `available`, a `reason` when it isn't (`deviceNotEligible`,
`appleIntelligenceNotEnabled`, `modelNotReady`, `osTooOld`), and `contextSize`.
