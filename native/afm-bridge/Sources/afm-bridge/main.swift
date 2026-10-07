// afm-bridge — Apple's on-device language model for the desktop app, over a
// line-oriented JSON protocol on stdin/stdout. No network listener, so nothing
// on the machine but the process that spawned it can reach the model.
//
//   → {"id":1,"op":"health"}
//   ← {"id":1,"ok":true,"available":true,"contextSize":4096}
//
// The protocol itself (complete, sessions, end, the guardrail retry) is
// AppleModelCore, shared with the iOS plugin (ios/Sources/AppleModelPlugin).

import Foundation
import AFMCore

func write(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

// Requests are handled one at a time, in order: the model runs one generation
// at a time anyway, and in-order answers keep the protocol trivial.
let core = AppleModelCore()
while let line = readLine(strippingNewline: true) {
    if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
    guard let data = line.data(using: .utf8) else {
        write(["id": -1, "ok": false, "error": "bad request"])
        continue
    }
    write(await core.handle(data))
}
