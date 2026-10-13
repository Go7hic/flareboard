import Foundation

/// The panel's languages, as the dashboard has them.
public enum Lang: String, CaseIterable, Codable, Sendable {
    case en, zh, ja, de, fr

    /// The language's own name, for the settings.
    public var nativeName: String {
        switch self {
        case .en: "English"
        case .zh: "简体中文"
        case .ja: "日本語"
        case .de: "Deutsch"
        case .fr: "Français"
        }
    }

    public var locale: Locale {
        switch self {
        case .en: Locale(identifier: "en_US")
        case .zh: Locale(identifier: "zh_CN")
        case .ja: Locale(identifier: "ja_JP")
        case .de: Locale(identifier: "de_DE")
        case .fr: Locale(identifier: "fr_FR")
        }
    }

    public var texts: Texts {
        switch self {
        case .en: .en
        case .zh: .zh
        case .ja: .ja
        case .de: .de
        case .fr: .fr
        }
    }

    /// The language for a system locale such as "zh-Hans-CN" or "de_AT"; English otherwise.
    public static func from(localeIdentifier id: String) -> Lang {
        let lower = id.lowercased()
        for lang in allCases where lower == lang.rawValue || lower.hasPrefix(lang.rawValue + "-") || lower.hasPrefix(lang.rawValue + "_") {
            return lang
        }
        return .en
    }

    /// The first of the user's preferred languages the panel speaks.
    public static var system: Lang {
        for id in Locale.preferredLanguages {
            let lang = from(localeIdentifier: id)
            if lang != .en || id.lowercased().hasPrefix("en") { return lang }
        }
        return .en
    }
}

/// The panel's copy in one language. Formats take %@ for text and %d for whole numbers.
public struct Texts: Sendable {
    public let lang: Lang

    public let title: String
    public let openFlareboard: String
    public let openDashboard: String
    public let quit: String
    public let version: String

    // Connecting.
    public let connectTitle: String
    public let connectLead: String
    public let apiKey: String
    public let connect: String
    public let connecting: String
    public let createKey: String
    public let selfHosted: String
    public let apiBase: String
    public let apiBaseHint: String
    public let consoleURL: String
    public let consoleHint: String
    public let needKey: String
    public let needPersonal: String
    public let badKey: String
    public let noScope: String
    public let offline: String
    public let timeout: String

    // Stats.
    public let switchWebsite: String
    public let addWebsite: String
    public let refresh: String
    public let settings: String
    public let period: String
    public let periods: [String]
    public let compared: [String]
    public let visitors: String
    public let visitorsCount: String
    public let pageviews: String
    public let visits: String
    public let bounce: String
    public let topPages: String
    public let views: String
    public let now: String
    public let today: String
    public let online: String
    public let updatedNow: String
    public let updated: String
    public let minutesAgo: String
    public let hoursAgo: String
    public let retry: String
    public let noSitesTitle: String
    public let noSitesBody: String
    public let noVisitors: [String]
    public let chartLabel: String
    public let openPage: String

    // Settings.
    public let back: String
    public let account: String
    public let disconnect: String
    public let menuBar: String
    public let showInMenu: String
    public let trayModes: [String]
    public let general: String
    public let language: String
    public let system: String
    public let openAtLogin: String
    public let loginFailed: String
    public let connection: String
    public let save: String
    public let saving: String

    // Updates.
    public let updates: String
    public let autoUpdate: String
    public let checkNow: String
    public let checkUpdates: String
    public let checking: String
    public let upToDate: String
    public let updateAvailable: String
    public let installUpdate: String
    public let downloading: String
    public let installing: String
    public let updateFailed: String
    public let moveToApplications: String
    public let cannotReplace: String
    public let untrustedUpdate: String
}

extension Texts {
    public static let en = Texts(
        lang: .en,
        title: "Flareboard",
        openFlareboard: "Open Flareboard",
        openDashboard: "Open dashboard",
        quit: "Quit Flareboard",
        version: "Version %@",
        connectTitle: "Connect Flareboard",
        connectLead: "See who is on your website from the menu bar. Paste a personal API key: read access is enough.",
        apiKey: "API key",
        connect: "Connect",
        connecting: "Connecting…",
        createKey: "Create an API key",
        selfHosted: "Self-hosted server",
        apiBase: "API URL",
        apiBaseHint: "Your own API, if you run Flareboard yourself.",
        consoleURL: "Dashboard URL",
        consoleHint: "Leave blank to guess it from the API URL.",
        needKey: "Paste a personal API key.",
        needPersonal: "This is a project key (fb_pk_…). Use a personal key that starts with fb_sk_.",
        badKey: "This API key does not work. It may have been revoked: create a new one in the dashboard.",
        noScope: "This API key cannot read stats. Create one with read access.",
        offline: "Can't reach %@. Check your connection.",
        timeout: "%@ is taking too long to answer.",
        switchWebsite: "Switch website",
        addWebsite: "Add a website…",
        refresh: "Refresh",
        settings: "Settings",
        period: "Period",
        periods: ["24h", "7d", "30d"],
        compared: ["vs previous 24 hours", "vs previous 7 days", "vs previous 30 days"],
        visitors: "Visitors",
        visitorsCount: "%@ visitors",
        pageviews: "Pageviews",
        visits: "Visits",
        bounce: "Bounce rate",
        topPages: "Top pages",
        views: "Views",
        now: "Now",
        today: "Today",
        online: "%@ online",
        updatedNow: "Updated just now",
        updated: "Updated %@",
        minutesAgo: "%d min ago",
        hoursAgo: "%d h ago",
        retry: "Try again",
        noSitesTitle: "No websites yet",
        noSitesBody: "Add a website in the dashboard and its traffic shows up here.",
        noVisitors: ["No visitors in the last 24 hours", "No visitors in the last 7 days", "No visitors in the last 30 days"],
        chartLabel: "Visitors over time",
        openPage: "Open %@",
        back: "Back",
        account: "Account",
        disconnect: "Disconnect",
        menuBar: "Menu bar",
        showInMenu: "Next to the icon",
        trayModes: ["Online now", "Visitors", "Nothing"],
        general: "General",
        language: "Language",
        system: "System",
        openAtLogin: "Open at login",
        loginFailed: "Couldn't change this. Move Flareboard to Applications and try again.",
        connection: "Connection",
        save: "Save",
        saving: "Saving…",
        updates: "Updates",
        autoUpdate: "Check for updates automatically",
        checkNow: "Check now",
        checkUpdates: "Check for Updates…",
        checking: "Checking…",
        upToDate: "Flareboard is up to date.",
        updateAvailable: "Version %@ is available.",
        installUpdate: "Install and relaunch",
        downloading: "Downloading… %d%%",
        installing: "Installing…",
        updateFailed: "The update failed: %@",
        moveToApplications: "Move Flareboard to Applications to install updates.",
        cannotReplace: "Flareboard can't replace itself here. Download the update from GitHub.",
        untrustedUpdate: "The update's signature could not be verified, so it was not installed."
    )

    public static let zh = Texts(
        lang: .zh,
        title: "Flareboard",
        openFlareboard: "打开 Flareboard",
        openDashboard: "打开控制台",
        quit: "退出 Flareboard",
        version: "版本 %@",
        connectTitle: "连接 Flareboard",
        connectLead: "在菜单栏随时看到网站的访客。粘贴一个个人 API 密钥，只读权限就够了。",
        apiKey: "API 密钥",
        connect: "连接",
        connecting: "正在连接…",
        createKey: "创建 API 密钥",
        selfHosted: "自托管服务器",
        apiBase: "API 地址",
        apiBaseHint: "自己部署 Flareboard 时，填你自己的 API 地址。",
        consoleURL: "控制台地址",
        consoleHint: "留空则按 API 地址推断。",
        needKey: "请粘贴个人 API 密钥。",
        needPersonal: "这是项目密钥（fb_pk_…），请使用以 fb_sk_ 开头的个人密钥。",
        badKey: "这个 API 密钥无效，可能已被撤销。请在控制台重新创建一个。",
        noScope: "这个 API 密钥没有读取统计的权限，请创建一个带只读权限的密钥。",
        offline: "无法连接 %@，请检查网络。",
        timeout: "%@ 响应超时。",
        switchWebsite: "切换网站",
        addWebsite: "添加网站…",
        refresh: "刷新",
        settings: "设置",
        period: "时间范围",
        periods: ["24 小时", "7 天", "30 天"],
        compared: ["较前 24 小时", "较前 7 天", "较前 30 天"],
        visitors: "访客",
        visitorsCount: "%@ 位访客",
        pageviews: "浏览量",
        visits: "访问",
        bounce: "跳出率",
        topPages: "热门页面",
        views: "浏览",
        now: "现在",
        today: "今天",
        online: "%@ 人在线",
        updatedNow: "刚刚更新",
        updated: "%@更新",
        minutesAgo: "%d 分钟前",
        hoursAgo: "%d 小时前",
        retry: "重试",
        noSitesTitle: "还没有网站",
        noSitesBody: "在控制台添加网站后，这里就会显示它的流量。",
        noVisitors: ["最近 24 小时没有访客", "最近 7 天没有访客", "最近 30 天没有访客"],
        chartLabel: "访客趋势",
        openPage: "打开 %@",
        back: "返回",
        account: "账户",
        disconnect: "断开连接",
        menuBar: "菜单栏",
        showInMenu: "图标旁显示",
        trayModes: ["在线人数", "访客", "不显示"],
        general: "通用",
        language: "语言",
        system: "跟随系统",
        openAtLogin: "登录时打开",
        loginFailed: "无法更改。请把 Flareboard 移到“应用程序”后再试。",
        connection: "连接",
        save: "保存",
        saving: "正在保存…",
        updates: "更新",
        autoUpdate: "自动检查更新",
        checkNow: "立即检查",
        checkUpdates: "检查更新…",
        checking: "正在检查…",
        upToDate: "已是最新版本。",
        updateAvailable: "有新版本 %@。",
        installUpdate: "安装并重启",
        downloading: "正在下载… %d%%",
        installing: "正在安装…",
        updateFailed: "更新失败：%@",
        moveToApplications: "请先把 Flareboard 移到“应用程序”文件夹，再安装更新。",
        cannotReplace: "Flareboard 无法在当前位置替换自己，请从 GitHub 下载更新。",
        untrustedUpdate: "更新包的签名无法验证，已拒绝安装。"
    )
}
