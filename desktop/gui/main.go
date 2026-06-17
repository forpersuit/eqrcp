package main

import (
	"context"
	"embed"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2"
	wailslogger "github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"golang.org/x/term"

	"eqt/cmd"
)

//go:embed all:frontend/dist
var assets embed.FS

type FileLogger struct {
	file *os.File
}

func NewFileLogger(filePath string) *FileLogger {
	_ = os.MkdirAll(filepath.Dir(filePath), 0755)
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return &FileLogger{}
	}
	return &FileLogger{file: f}
}

func (l *FileLogger) Close() {
	if l.file != nil {
		_ = l.file.Close()
	}
}

func (l *FileLogger) log(level string, message string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	line := fmt.Sprintf("[%s] [%s] %s\n", timestamp, level, message)
	fmt.Print(line)
	if l.file != nil {
		_, _ = l.file.WriteString(line)
		_ = l.file.Sync()
	}
}

func (l *FileLogger) Print(message string)   { l.log("PRINT", message) }
func (l *FileLogger) Trace(message string)   { l.log("TRACE", message) }
func (l *FileLogger) Debug(message string)   { l.log("DEBUG", message) }
func (l *FileLogger) Info(message string)    { l.log("INFO", message) }
func (l *FileLogger) Warning(message string) { l.log("WARN", message) }
func (l *FileLogger) Error(message string)   { l.log("ERROR", message) }
func (l *FileLogger) Fatal(message string)   { l.log("FATAL", message) }

func desktopLogFilePath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "eqt", "desktop.log")
}

func main() {
	args := os.Args[1:]

	// 1. 如果有显式的命令行子命令（如 send, receive 等），强制走 CLI 模式
	if len(args) > 0 && isCLICommand(args[0]) {
		runCLIMode()
		return
	}

	// 2. 如果没有任何参数，进行自动路由探测
	if len(args) == 0 {
		if runGUIOrCLI() {
			startWailsGUI()
			return
		}
		runCLIMode()
		return
	}

	// 3. 右键静默转发逻辑 (原来 launcher.exe 的角色)
	if isRightClickAction(args) {
		runSilentLauncher(args)
		return
	}

	// 默认回退到命令行执行
	runCLIMode()
}

func isCLICommand(name string) bool {
	switch name {
	case "send", "receive", "config", "desktop", "completion", "chat", "version", "help":
		return true
	default:
		return false
	}
}

func runCLIMode() {
	_ = attachWindowsConsole()
	defer detachWindowsConsole()

	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func runGUIOrCLI() bool {
	if isWindows() {
		hasParentConsole := attachWindowsConsole()
		if hasParentConsole {
			detachWindowsConsole()
			return false // 走 CLI
		}
		return true // 双击启动，走 GUI
	}

	hasDisplay := os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
	isTerminal := term.IsTerminal(int(os.Stdout.Fd()))
	return hasDisplay && !isTerminal
}

func startWailsGUI() {
	logPath := desktopLogFilePath()
	fileLogger := NewFileLogger(logPath)
	defer fileLogger.Close()

	fileLogger.Info("EQT GUI Starting...")

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
		HideWindowOnClose: false,
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Inject CSP that allows the chat iframe (served by the local agent
			// HTTP server at 127.0.0.1) to load inside this Wails webview.
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Security-Policy",
						"default-src 'self' 'unsafe-inline' 'unsafe-eval'; "+
							"connect-src 'self' http://127.0.0.1:* http://localhost:*; "+
							"img-src 'self' data: http://127.0.0.1:* http://localhost:* http://*:* https://*:*; "+
							"frame-src 'self' http://127.0.0.1:* http://localhost:* http://*:* https://*:*")
					next.ServeHTTP(w, r)
				})
			},
		},
		BackgroundColour: &options.RGBA{R: 245, G: 247, B: 244, A: 1},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "eqt-desktop",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				app.showWindow()
			},
		},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			tray.startTray()
		},
		OnBeforeClose: app.beforeClose,
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
		Logger:   fileLogger,
		LogLevel: wailslogger.INFO,
	})

	if err != nil {
		fileLogger.Fatal(fmt.Sprintf("Wails Run error: %v", err))
		println("Error:", err.Error())
	}
}
