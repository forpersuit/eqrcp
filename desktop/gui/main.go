package main

import (
	"context"
	"embed"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()
	tray := newTrayController(app)

	// Create application with options
	err := wails.Run(&options.App{
		Title:             "EQT",
		Width:             1120,
		Height:            760,
		MinWidth:          900,
		MinHeight:         640,
		HideWindowOnClose: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Inject CSP that allows the chat iframe (served by the local agent
			// HTTP server at 127.0.0.1) to load inside this Wails webview.
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Security-Policy",
						"default-src 'self' 'unsafe-inline' 'unsafe-eval'; "+
							"connect-src 'self' http://127.0.0.1:* http://localhost:*; "+
							"frame-src http://*:* https://*:*")
					next.ServeHTTP(w, r)
				})
			},
		},
		BackgroundColour: &options.RGBA{R: 245, G: 247, B: 244, A: 1},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			tray.startTray()
		},
		OnShutdown: func(ctx context.Context) {
			tray.shutdown()
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
