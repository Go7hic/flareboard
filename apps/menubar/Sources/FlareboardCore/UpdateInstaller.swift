import AppKit
import CryptoKit
import Darwin
import Foundation
import Security

// Ported from Cleer's updater (CleerCore/UpdateInstaller.swift): the disk image is downloaded over
// HTTPS, checked against GitHub's SHA-256, and the app inside it must be a Developer ID build of
// this app from the same team that Gatekeeper accepts before it may replace the running one.

public enum UpdateInstallerError: Error, Equatable, Sendable {
    case downloadFailed(String)
    case insecureDownloadURL
    case digestMismatch
    case untrustedSignature(String)
    case translocated
    case targetNotWritable
    case mountFailed
    case appNotFoundInDMG
    case installFailed
    case noDownloadedUpdate

    public func message(_ t: Texts) -> String {
        switch self {
        case .downloadFailed(let reason): String(format: t.updateFailed, reason)
        case .insecureDownloadURL, .digestMismatch, .untrustedSignature: t.untrustedUpdate
        case .translocated: t.moveToApplications
        case .targetNotWritable: t.cannotReplace
        case .mountFailed, .appNotFoundInDMG, .installFailed, .noDownloadedUpdate:
            String(format: t.updateFailed, String(describing: self))
        }
    }
}

/// Checks that an app bundle is a Developer ID build of this app from the expected team, and
/// that Gatekeeper accepts it.
public struct UpdateBundleVerifier: Sendable {
    public var teamIdentifier = "CE8N4Z6AQ3"
    public var bundleIdentifier = "dev.flareboard.menubar"
    public var requiresGatekeeper = true

    public init() {}

    public var requirementText: String {
        "anchor apple generic and identifier \"\(bundleIdentifier)\" and certificate leaf[subject.OU] = \"\(teamIdentifier)\""
    }

    public func verify(appURL: URL) throws {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(appURL as CFURL, [], &staticCode) == errSecSuccess, let staticCode else {
            throw UpdateInstallerError.untrustedSignature("unsigned bundle")
        }
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(requirementText as CFString, [], &requirement) == errSecSuccess, let requirement else {
            throw UpdateInstallerError.untrustedSignature("invalid requirement")
        }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate)
        let status = SecStaticCodeCheckValidity(staticCode, flags, requirement)
        guard status == errSecSuccess else {
            throw UpdateInstallerError.untrustedSignature(SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)")
        }
        if requiresGatekeeper {
            let spctl = Process()
            spctl.executableURL = URL(fileURLWithPath: "/usr/sbin/spctl")
            spctl.arguments = ["--assess", "--type", "execute", appURL.path]
            spctl.standardOutput = FileHandle.nullDevice
            spctl.standardError = FileHandle.nullDevice
            do {
                try spctl.run()
                spctl.waitUntilExit()
            } catch {
                throw UpdateInstallerError.untrustedSignature("Gatekeeper assessment could not run")
            }
            guard spctl.terminationStatus == 0 else {
                throw UpdateInstallerError.untrustedSignature("Gatekeeper rejected the app")
            }
        }
    }
}

public enum UpdateInstallerState: Equatable, Sendable {
    case idle
    case downloading(progress: Double)
    case readyToInstall
    case installing
    case failed(UpdateInstallerError)
}

public final class UpdateInstaller: NSObject, @unchecked Sendable {
    private let lock = NSLock()
    private var downloadTask: URLSessionDownloadTask?
    private var expectedSHA256: String?
    private var downloadedDMG: URL?
    private var lastReportedProgress = 0.0
    private let verifier: UpdateBundleVerifier
    private lazy var session: URLSession = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()

    /// Called on a background queue.
    public var onStateChanged: (@Sendable (UpdateInstallerState) -> Void)?

    public init(verifier: UpdateBundleVerifier = UpdateBundleVerifier()) {
        self.verifier = verifier
        super.init()
    }

    /// Fails early, before downloading, when the app could not replace itself.
    public static func checkReplaceable(bundlePath: String = Bundle.main.bundlePath) throws {
        _ = try replaceableTarget(bundlePath: bundlePath)
    }

    public func download(from url: URL, expectedSHA256: String?) {
        guard url.scheme?.lowercased() == "https" else {
            onStateChanged?(.failed(.insecureDownloadURL))
            return
        }
        let task = session.downloadTask(with: url)
        lock.withLock {
            downloadTask?.cancel()
            downloadTask = task
            self.expectedSHA256 = expectedSHA256?.lowercased()
            downloadedDMG = nil
            lastReportedProgress = 0
        }
        onStateChanged?(.downloading(progress: 0))
        task.resume()
    }

    public func cancel() {
        lock.withLock {
            downloadTask?.cancel()
            downloadTask = nil
            downloadedDMG = nil
        }
    }

    public func installAndRelaunch() {
        guard let dmg = lock.withLock({ downloadedDMG }) else {
            onStateChanged?(.failed(.noDownloadedUpdate))
            return
        }
        onStateChanged?(.installing)
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try install(dmg: dmg)
            } catch let error as UpdateInstallerError {
                onStateChanged?(.failed(error))
            } catch {
                onStateChanged?(.failed(.installFailed))
            }
        }
    }

    private func isCurrent(_ task: URLSessionTask) -> Bool {
        lock.withLock { downloadTask === task }
    }

    /// Where the running app lives, or an error when it can't be replaced in place.
    static func replaceableTarget(bundlePath: String) throws -> URL {
        guard !bundlePath.contains("/AppTranslocation/") else { throw UpdateInstallerError.translocated }
        let target = URL(fileURLWithPath: bundlePath)
        guard target.pathExtension == "app",
              FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path)
        else { throw UpdateInstallerError.targetNotWritable }
        return target
    }

    private func install(dmg: URL) throws {
        let target = try Self.replaceableTarget(bundlePath: Bundle.main.bundlePath)
        let (mountPoint, appInDMG) = try mountVerifiedApp(dmg: dmg)
        let script = FileManager.default.temporaryDirectory.appendingPathComponent("flareboard-update-\(UUID().uuidString.prefix(8)).sh")
        do {
            try Self.installScript.write(to: script, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        } catch {
            unmount(mountPoint)
            throw UpdateInstallerError.installFailed
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/bash")
        task.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), target.path, appInDMG.path, mountPoint.path]
        task.standardInput = Pipe()
        do {
            try task.run()
        } catch {
            unmount(mountPoint)
            throw UpdateInstallerError.installFailed
        }
        DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { Darwin.exit(0) }
    }

    /// Mounts the disk image read-only and returns the verified app inside it. The caller owns
    /// the mount on success; it is detached on failure.
    private func mountVerifiedApp(dmg: URL) throws -> (mountPoint: URL, app: URL) {
        let mountPoint = dmg.deletingLastPathComponent().appendingPathComponent("mnt-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? FileManager.default.createDirectory(at: mountPoint, withIntermediateDirectories: true)
        let attach = Process()
        attach.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
        attach.arguments = ["attach", dmg.path, "-readonly", "-nobrowse", "-mountpoint", mountPoint.path, "-quiet"]
        attach.standardOutput = FileHandle.nullDevice
        attach.standardError = FileHandle.nullDevice
        do {
            try attach.run()
            attach.waitUntilExit()
        } catch {
            throw UpdateInstallerError.mountFailed
        }
        guard attach.terminationStatus == 0 else { throw UpdateInstallerError.mountFailed }
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Flareboard"
        let app = mountPoint.appendingPathComponent("\(name).app")
        guard FileManager.default.fileExists(atPath: app.path) else {
            unmount(mountPoint)
            throw UpdateInstallerError.appNotFoundInDMG
        }
        do {
            try verifier.verify(appURL: app)
        } catch {
            unmount(mountPoint)
            throw error
        }
        return (mountPoint, app)
    }

    /// Paths arrive as positional arguments, so the shell never parses them. The new app is
    /// copied next to the old one and swapped in with renames, so a failed copy leaves the
    /// installed app untouched.
    static let installScript = """
        #!/bin/bash
        set -u
        pid="$1"
        target="$2"
        source_app="$3"
        mount_point="$4"
        staging="${target}.flareboard-update-$$"
        backup="${target}.flareboard-backup-$$"

        finish() {
            /usr/bin/hdiutil detach "$mount_point" -force -quiet 2>/dev/null || true
            /usr/bin/open "$target"
            exit "$1"
        }

        for _ in {1..20}; do
            if ! kill -0 "$pid" 2>/dev/null; then break; fi
            sleep 0.5
        done
        if kill -0 "$pid" 2>/dev/null; then
            /usr/bin/hdiutil detach "$mount_point" -force -quiet 2>/dev/null || true
            exit 1
        fi
        sleep 0.5

        /bin/rm -rf "$staging"
        if ! /usr/bin/ditto "$source_app" "$staging" || ! /usr/bin/codesign --verify --strict "$staging"; then
            /bin/rm -rf "$staging"
            finish 1
        fi
        if ! /bin/mv "$target" "$backup"; then
            /bin/rm -rf "$staging"
            finish 1
        fi
        if ! /bin/mv "$staging" "$target"; then
            /bin/mv "$backup" "$target"
            /bin/rm -rf "$staging"
            finish 1
        fi
        /bin/rm -rf "$backup"
        finish 0
        """

    private func unmount(_ mountPoint: URL) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
        task.arguments = ["detach", mountPoint.path, "-force", "-quiet"]
        try? task.run()
        task.waitUntilExit()
    }

    static func sha256Hex(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

extension UpdateInstaller: URLSessionDownloadDelegate {
    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0, isCurrent(downloadTask) else { return }
        let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        let report = lock.withLock {
            guard progress - lastReportedProgress >= 0.01 || progress >= 1 else { return false }
            lastReportedProgress = progress
            return true
        }
        if report { onStateChanged?(.downloading(progress: progress)) }
    }

    public func urlSession(_ session: URLSession, downloadTask task: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard isCurrent(task) else { return }
        if let http = task.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            onStateChanged?(.failed(.downloadFailed("HTTP \(http.statusCode)")))
            return
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("FlareboardUpdate-\(UUID().uuidString.prefix(8))")
        let dmg = dir.appendingPathComponent("Flareboard.dmg")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: location, to: dmg)
            if let expected = lock.withLock({ expectedSHA256 }) {
                guard try Self.sha256Hex(of: dmg) == expected else { throw UpdateInstallerError.digestMismatch }
            }
            // Reject an untrusted package now rather than after the user clicks install.
            let (mountPoint, _) = try mountVerifiedApp(dmg: dmg)
            unmount(mountPoint)
            guard isCurrent(task) else { return }
            lock.withLock { downloadedDMG = dmg }
            onStateChanged?(.readyToInstall)
        } catch {
            try? FileManager.default.removeItem(at: dir)
            guard isCurrent(task) else { return }
            onStateChanged?(.failed(error as? UpdateInstallerError ?? .downloadFailed(error.localizedDescription)))
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, isCurrent(task), (error as NSError).code != NSURLErrorCancelled else { return }
        onStateChanged?(.failed(.downloadFailed(error.localizedDescription)))
    }
}
