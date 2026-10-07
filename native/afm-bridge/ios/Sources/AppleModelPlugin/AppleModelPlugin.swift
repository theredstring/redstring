import Foundation
import Capacitor

/// Apple's on-device model on iPhone and iPad, for the Druid and the Wizard's
/// chat: the same requests the Mac helper takes (AppleModelCore), as one
/// Capacitor method. From JavaScript:
///
///   registerPlugin('AppleModel').send({ request: { op: 'health' } })
///     → { ok: true, available: true, contextSize: 4096 }
@objc(AppleModelPlugin)
public class AppleModelPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleModelPlugin"
    public let jsName = "AppleModel"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise)
    ]

    @MainActor private lazy var core = AppleModelCore()

    @objc func send(_ call: CAPPluginCall) {
        guard let request = call.getObject("request"),
              let data = try? JSONSerialization.data(withJSONObject: request) else {
            call.resolve(["ok": false, "error": "bad request"])
            return
        }
        Task { @MainActor in
            let reply = await self.core.handle(data)
            call.resolve(reply)
        }
    }
}
