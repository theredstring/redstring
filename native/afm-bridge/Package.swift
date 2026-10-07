// swift-tools-version: 6.2
import PackageDescription

// The Mac helper (afm-bridge). The iOS plugin is built from the same core by
// CocoaPods instead (RedstringAppleModel.podspec), through Capacitor.
let package = Package(
    name: "afm-bridge",
    platforms: [.macOS(.v26)],
    targets: [
        .target(name: "AFMCore", path: "Sources/AFMCore"),
        .executableTarget(name: "afm-bridge", dependencies: ["AFMCore"], path: "Sources/afm-bridge")
    ]
)
