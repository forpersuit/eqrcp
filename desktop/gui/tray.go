package main

import (
	"embed"
	"log"
	"sync"

	"fyne.io/systray"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed frontend/src/assets/images/logo-universal.png
var trayAssets embed.FS

type trayController struct {
	app   *App
	start func()
	end   func()
	once  sync.Once
}

func newTrayController(app *App) *trayController {
	tray := &trayController{app: app}
	tray.start, tray.end = systray.RunWithExternalLoop(tray.onReady, tray.onExit)
	return tray
}

func (t *trayController) startTray() {
	if t == nil || t.start == nil {
		return
	}
	t.once.Do(t.start)
}

func (t *trayController) shutdown() {
	if t == nil || t.end == nil {
		return
	}
	t.end()
}

func (t *trayController) onReady() {
	icon, err := trayAssets.ReadFile("frontend/src/assets/images/logo-universal.png")
	if err == nil {
		systray.SetIcon(icon)
	} else {
		log.Printf("load tray icon: %v", err)
	}
	systray.SetTitle("EQT")
	systray.SetTooltip("EQT - Easy QR Transfer")

	open := systray.AddMenuItem("Open EQT", "Show the EQT window")
	share := systray.AddMenuItem("Share...", "Open the share workflow")
	receive := systray.AddMenuItem("Receive...", "Open the receive workflow")
	systray.AddSeparator()
	openCurrent := systray.AddMenuItem("Open Current QR", "Open the active transfer QR page")
	stopCurrent := systray.AddMenuItem("Stop Current Transfer", "Stop the active transfer")
	systray.AddSeparator()
	settings := systray.AddMenuItem("Settings", "Open EQT settings")
	about := systray.AddMenuItem("About EQT", "Show product information")
	feedback := systray.AddMenuItem("Send Feedback", "Open the feedback form")
	systray.AddSeparator()
	quit := systray.AddMenuItem("Quit", "Quit EQT")

	systray.SetOnTapped(func() {
		t.showAndEmit("")
	})
	go t.handle(open, func() { t.showAndEmit("") })
	go t.handle(share, func() { t.showAndEmit("share") })
	go t.handle(receive, func() { t.showAndEmit("receive") })
	go t.handle(openCurrent, t.openCurrentQR)
	go t.handle(stopCurrent, t.stopCurrent)
	go t.handle(settings, func() { t.showAndEmit("settings") })
	go t.handle(about, func() { t.showAndEmit("about") })
	go t.handle(feedback, func() { t.showAndEmit("feedback") })
	go t.handle(quit, t.quit)
}

func (t *trayController) onExit() {}

func (t *trayController) handle(item *systray.MenuItem, fn func()) {
	for range item.ClickedCh {
		fn()
	}
}

func (t *trayController) showAndEmit(command string) {
	t.app.showWindow()
	if command != "" {
		t.app.emitTrayCommand(command)
	}
}

func (t *trayController) openCurrentQR() {
	t.app.showWindow()
	status, err := t.app.AgentStatus()
	if err != nil {
		t.app.emitTrayCommand("refresh")
		return
	}
	if status.Current == nil || status.Current.PageURL == "" {
		t.app.emitTrayCommand("refresh")
		return
	}
	if err := t.app.OpenURL(status.Current.PageURL); err != nil {
		t.app.emitTrayCommand("refresh")
	}
}

func (t *trayController) stopCurrent() {
	t.app.showWindow()
	if err := t.app.StopCurrent(); err != nil {
		t.app.emitTrayCommand("refresh")
		return
	}
	t.app.emitTrayCommand("refresh")
}

func (t *trayController) quit() {
	systray.Quit()
	if t.app.ctx != nil {
		wailsruntime.Quit(t.app.ctx)
	}
}
