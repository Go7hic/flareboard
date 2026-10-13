// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Flareboard",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Flareboard", targets: ["Flareboard"])
    ],
    targets: [
        // Everything that does not draw: the API, formatting, copy, the chart's data and updates.
        .target(name: "FlareboardCore"),
        // The menu bar item, its panel and the settings, in SwiftUI.
        .executableTarget(
            name: "Flareboard",
            dependencies: ["FlareboardCore"]
        ),
        .testTarget(
            name: "FlareboardCoreTests",
            dependencies: ["FlareboardCore"]
        )
    ]
)
