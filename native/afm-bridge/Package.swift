// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "afm-bridge",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(name: "afm-bridge", path: "Sources/afm-bridge")
    ]
)
