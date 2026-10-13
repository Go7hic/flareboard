package main

import (
	"log"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	"github.com/egoist/mygo/plugins/updater/native"
)

func main() {
	a := newApp()
	mygo.App.SetName("Flareboard")
	mygo.App.SetActivationPolicy(mygo.ActivationPolicyAccessory)
	mygo.App.OnWindowAllClosed(func() {})
	// The update window checks GitHub releases tagged menubar-v… once a day,
	// in the language the settings chose when the app started.
	saved, _ := loadSettings()
	mygo.Use(native.New(updater.Options{Language: updaterLanguage(saved.Language)}))
	mygo.App.WhenReady(a.ready)
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
