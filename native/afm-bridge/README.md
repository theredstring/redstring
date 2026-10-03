# afm-bridge

Apple's on-device language model (FoundationModels, macOS 26+) for the Druid, over stdio.

```bash
swift build -c release --package-path native/afm-bridge
npm run druid -- --mind afm
```

One JSON object per line each way. There is no network listener. Requests: `health`, `prewarm`, `complete` (with an optional answer schema: an object of string properties, each optionally a string enum, enforced by guided generation). See `Sources/afm-bridge/main.swift` and `src/druid/mind/afmBackend.js`.

The model needs Apple Intelligence turned on. `health` reports `available`, a `reason` when it isn't, and `contextSize`.
