package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

// appUpdater checks for new versions. Tests swap in a fake, as the plugin
// only answers in a running app.
type appUpdater interface {
	Enabled() bool
	Check()
	Automatic() bool
	SetAutomatic(on bool)
}

type pluginUpdater struct{}

func (pluginUpdater) Enabled() bool        { return mygo.Updater.Enabled() }
func (pluginUpdater) Check()               { updater.CheckForUpdates() }
func (pluginUpdater) Automatic() bool      { return updater.AutomaticChecks() }
func (pluginUpdater) SetAutomatic(on bool) { updater.SetAutomaticChecks(on) }

// updaterLanguage is the update window's language tag for a language of
// the settings; empty follows the system, as the panel does.
func updaterLanguage(lang string) string {
	if lang == "zh" {
		return "zh-Hans"
	}
	return lang
}
