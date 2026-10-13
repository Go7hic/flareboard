import FlareboardCore
import SwiftUI

/// The first screen: what the app does, and the key.
struct ConnectView: View {
    @Bindable var model: AppModel
    @State private var selfHosted = false

    var body: some View {
        let t = model.texts
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    LogoMark(size: 44)
                    Text(t.connectTitle)
                        .font(.system(size: 18, weight: .semibold))
                        .padding(.top, 16)
                        .padding(.bottom, 6)
                    Text(t.connectLead)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t.apiKey).font(.system(size: 12, weight: .medium))
                        SecureField("fb_sk_…", text: $model.draftKey)
                            .textFieldStyle(.roundedBorder)
                            .controlSize(.large)
                            .onSubmit { model.connect() }
                        if let error = model.formError {
                            Text(error).font(.system(size: 11)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.top, 22)
                    Button {
                        model.connect()
                    } label: {
                        Text(model.connecting ? t.connecting : t.connect).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.connecting)
                    .padding(.top, 12)
                    if let url = model.apiKeysURL {
                        Link(destination: url) { Text(t.createKey + " ↗").font(.system(size: 12)) }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 12)
                    }
                    DisclosureGroup(isExpanded: $selfHosted) {
                        ServerFields(model: model).padding(.top, 10)
                    } label: {
                        Text(t.selfHosted).font(.system(size: 12))
                    }
                    .padding(.top, 20)
                }
                .padding(.horizontal, 24)
                .padding(.top, 32)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.never)
            HStack {
                Text(String(format: t.version, appVersionString)).font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                TextButton(title: t.quit) { NSApp.terminate(nil) }
            }
            .padding(.leading, 24)
            .padding(.trailing, 12)
            .padding(.vertical, 8)
        }
    }
}

struct ServerFields: View {
    @Bindable var model: AppModel

    var body: some View {
        let t = model.texts
        VStack(alignment: .leading, spacing: 12) {
            field(t.apiBase, hint: t.apiBaseHint, placeholder: defaultAPIBase, text: $model.draftBaseURL)
            field(t.consoleURL, hint: t.consoleHint, placeholder: defaultConsoleURL, text: $model.draftConsoleURL)
        }
    }

    private func field(_ label: String, hint: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .medium))
            TextField(placeholder, text: text).textFieldStyle(.roundedBorder)
            Text(hint).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The settings of a connected app.
struct SettingsView: View {
    @Bindable var model: AppModel

    var body: some View {
        let t = model.texts
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                IconButton(symbol: "chevron.left", label: t.back) { model.closeSettings() }
                Text(t.settings).font(.system(size: 14, weight: .semibold))
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, 2)
            Form {
                Section(t.account) {
                    HStack(spacing: 10) {
                        let name = model.account?.name ?? t.title
                        Circle()
                            .fill(Palette.series.opacity(0.15))
                            .frame(width: 30, height: 30)
                            .overlay(Text(String(name.prefix(1)).uppercased()).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.series))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                            Text(maskKey(model.apiKey)).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Button(t.disconnect) { model.disconnect() }
                    }
                }
                Section(t.menuBar) {
                    Picker(t.showInMenu, selection: Binding(get: { model.prefs.trayMode }, set: { model.setTrayMode($0) })) {
                        ForEach(Array(TrayMode.allCases.enumerated()), id: \.element) { i, mode in
                            Text(t.trayModes[i]).tag(mode)
                        }
                    }
                }
                Section(t.general) {
                    Picker(t.language, selection: Binding(get: { model.prefs.language }, set: { model.setLanguage($0) })) {
                        Text(t.system).tag(Lang?.none)
                        Divider()
                        ForEach(Lang.allCases, id: \.self) { lang in
                            Text(lang.nativeName).tag(Lang?.some(lang))
                        }
                    }
                    Toggle(t.openAtLogin, isOn: Binding(get: { model.openAtLogin }, set: { model.setOpenAtLogin($0) }))
                    if let error = model.loginError {
                        Text(error).font(.system(size: 11)).foregroundStyle(.red)
                    }
                }
                Section(t.updates) {
                    Toggle(t.autoUpdate, isOn: Binding(get: { model.prefs.autoUpdate }, set: { model.setAutoUpdate($0) }))
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(format: t.version, appVersionString))
                            if let status = updateLine(t) {
                                Text(status).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer()
                        if case .available = model.updateStatus {
                            Button(t.installUpdate) { model.installUpdate() }
                        } else {
                            Button(t.checkNow) { model.checkForUpdates(userInitiated: true) }
                                .disabled(model.updateStatus == .checking)
                        }
                    }
                }
                Section {
                    DisclosureGroup(t.connection) {
                        ServerFields(model: model).padding(.vertical, 6)
                        if let error = model.formError {
                            Text(error).font(.system(size: 11)).foregroundStyle(.red)
                        }
                        Button(model.connecting ? t.saving : t.save) { model.connect() }
                            .disabled(model.connecting)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .controlSize(.small)
            HStack {
                Spacer()
                TextButton(title: t.quit) { NSApp.terminate(nil) }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .onExitCommand { model.closeSettings() }
    }

    private func updateLine(_ t: Texts) -> String? {
        switch model.updateStatus {
        case .idle: nil
        case .checking: t.checking
        case .upToDate: t.upToDate
        case .available(let r): String(format: t.updateAvailable, r.version)
        case .downloading(_, let p): String(format: t.downloading, Int(p * 100))
        case .ready, .installing: t.installing
        case .failed(let message): message
        }
    }
}

/// The popover's content: the first screen, the stats, or the settings.
struct PanelView: View {
    @Bindable var model: AppModel

    var body: some View {
        Group {
            if !model.connected {
                ConnectView(model: model)
            } else if model.screen == .settings {
                SettingsView(model: model)
            } else {
                StatsView(model: model)
            }
        }
        .frame(width: PanelView.size.width, height: PanelView.size.height)
        .environment(\.locale, model.lang.locale)
    }

    static let size = CGSize(width: 360, height: 540)
}
