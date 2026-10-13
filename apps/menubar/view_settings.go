package main

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// appVersion is shown in the settings; keep it in step with mygo.json.
const appVersion = "0.2.0"

// connectView is the first screen: what the app does, and the key.
func (a *app) connectView(c *ui.Context) {
	t := c.Theme()
	txt := a.txt()
	ui.Scroll(c).Grow(1).FillWidth().Children(func() {
		ui.Column(c).FillWidth().Padding(32, 24, 16, 24).Gap(0).Children(func() {
			ui.Image(c, markBitmap()).Size(44, 44).Radius(10)
			ui.Text(c, txt.connectTitle).FontSize(18).FontWeight(600).LetterSpacing(-0.2).Margin(16, 0, 6, 0)
			ui.Text(c, txt.connectLead).FontSize(12).LineHeight(1.45).TextColor(t.TextMuted)
			ui.Column(c).FillWidth().Gap(12).Margin(22, 0, 0, 0).Children(func() {
				a.keyField(c)
				label := txt.connect
				if a.connecting {
					label = txt.connecting
				}
				if ui.PrimaryButton(c.Key("connect"), label).FillWidth().Height(30).Disabled(a.connecting).Clicked() {
					a.connect()
				}
				ui.Row(c).FillWidth().Justify(ui.Center).Children(func() {
					ui.Link(c, txt.createKey+" ↗", apiKeysURL(normalizeConsoleURL(a.draft.ConsoleURL, normalizeBaseURL(a.draft.BaseURL)))).FontSize(12)
				})
			})
			ui.Column(c).FillWidth().Margin(20, 0, 0, 0).Children(func() {
				ui.Collapsible(c.Key("self-hosted"), txt.selfHosted, &a.advancedOpen, func() {
					ui.Column(c).FillWidth().Gap(12).Padding(10, 0, 0, 0).Children(func() {
						a.serverFields(c)
					})
				}).FontSize(12)
			})
		})
	})
	ui.Row(c).FillWidth().Padding(8, 12, 10, 24).AlignItems(ui.Center).Children(func() {
		ui.Text(c, fmt.Sprintf(txt.version, appVersion)).FontSize(11).TextColor(t.TextMuted).Grow(1)
		if textButton(c.Key("quit"), txt.quit, nil).Clicked() {
			mygo.App.Quit()
		}
	})
}

func (a *app) keyField(c *ui.Context) {
	txt := a.txt()
	ui.Field(c, txt.apiKey, func() {
		ui.TextInput(c.Key("api-key"), &a.draft.APIKey).Password().Placeholder("fb_sk_…").OnSubmit(a.connect)
	}).Error(a.formErr)
}

func (a *app) serverFields(c *ui.Context) {
	txt := a.txt()
	ui.Field(c, txt.apiBase, func() {
		ui.TextInput(c.Key("api-base"), &a.draft.BaseURL).Placeholder(defaultAPIBase)
	}).Description(txt.apiBaseHint)
	ui.Field(c, txt.consoleURL, func() {
		ui.TextInput(c.Key("console"), &a.draft.ConsoleURL).Placeholder(defaultConsoleURL)
	}).Description(txt.consoleHint)
}

// settingsView is the settings of a connected app.
func (a *app) settingsView(c *ui.Context) {
	t := c.Theme()
	txt := a.txt()
	ui.Row(c).FillWidth().Padding(10, 16, 6, 10).Gap(4).AlignItems(ui.Center).Children(func() {
		if iconButton(c.Key("back"), iconChevronLeft, txt.back, false).Clicked() {
			a.closeSettings()
		}
		ui.Text(c, txt.settings).FontSize(14).FontWeight(600)
	})
	ui.Scroll(c).Grow(1).FillWidth().Children(func() {
		ui.Column(c).FillWidth().Padding(6, 16, 16, 16).Gap(8).Children(func() {
			sectionTitle(c, txt.account)
			group(c, func() {
				ui.Row(c).FillWidth().Padding(10).Gap(10).AlignItems(ui.Center).Children(func() {
					name := a.account.DisplayName
					if name == "" {
						name = a.account.Username
					}
					if name == "" {
						name = txt.title
					}
					ui.Avatar(c, name, nil).Size(30, 30)
					ui.Column(c).Grow(1).Shrink(1).Gap(1).Children(func() {
						ui.Text(c, name).FontSize(13).FontWeight(600).SingleLine()
						ui.Text(c, maskKey(a.settings.APIKey)).FontSize(11).TextColor(t.TextMuted).SingleLine()
					})
					if textButton(c.Key("disconnect"), txt.disconnect, iconLogOut).Clicked() {
						a.disconnect()
					}
				})
			})

			sectionTitle(c, txt.menuBar)
			group(c, func() {
				groupRow(c, txt.showInMenu, func() {
					if periodControl(c.Key("tray-mode"), &a.trayModeIndex, txt.trayModes, txt.showInMenu).Changed() {
						a.setTrayMode(trayModes[a.trayModeIndex])
					}
				})
			})

			sectionTitle(c, txt.general)
			group(c, func() {
				groupRow(c, txt.language, func() {
					if ui.Select(c.Key("language"), &a.langChoice, a.langOptions()).Label(txt.language).Width(150).Changed() {
						a.setLanguageChoice(a.langChoice)
					}
				})
				switchRow(c.Key("login"), txt.openAtLogin, &a.openAtLogin, a.setOpenAtLogin)
			})

			sectionTitle(c, txt.updates)
			group(c, func() {
				switchRow(c.Key("auto-update"), txt.autoUpdate, &a.autoUpdate, a.updates.SetAutomatic)
				groupRow(c, fmt.Sprintf(txt.version, appVersion), func() {
					if textButton(c.Key("check-updates"), txt.checkNow, nil).Clicked() {
						a.updates.Check()
					}
				})
			})
			if a.loginErr != "" {
				ui.Text(c, a.loginErr).FontSize(11).TextColor(t.Danger).Padding(0, 2)
			}

			ui.Column(c).FillWidth().Margin(6, 0, 0, 0).Children(func() {
				ui.Collapsible(c.Key("connection"), txt.connection, &a.advancedOpen, func() {
					ui.Column(c).FillWidth().Gap(12).Padding(10, 0, 0, 0).Children(func() {
						a.serverFields(c)
						if a.formErr != "" {
							ui.Text(c, a.formErr).FontSize(11).TextColor(t.Danger)
						}
						label := txt.save
						if a.connecting {
							label = txt.saving
						}
						if ui.Button(c.Key("save"), label).Disabled(a.connecting).AlignSelf(ui.Start).Clicked() {
							a.saveConnection()
						}
					})
				}).FontSize(12)
			})
		})
	})
	ui.Row(c).FillWidth().Padding(8, 12, 10, 16).AlignItems(ui.Center).Justify(ui.End).Children(func() {
		if textButton(c.Key("quit"), txt.quit, nil).Clicked() {
			mygo.App.Quit()
		}
	})
}

// maskKey shows the start and end of a key, as fb_sk_…3f9a.
func maskKey(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 10 {
		return "fb_sk_…"
	}
	return key[:6] + "…" + key[len(key)-4:]
}
