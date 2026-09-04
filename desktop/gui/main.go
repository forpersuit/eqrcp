package main

import (
	"context"
	"embed"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/wailsapp/wails/v2"
	wailslogger "github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"golang.org/x/term"

	"eqt/cmd"
	"eqt/desktop/crash"
	"eqt/pkg/application"
	"eqt/pkg/config"
	"eqt/pkg/server"
	"eqt/pkg/version"
)

//go:embed all:frontend/dist
var assets embed.FS

func desktopLogFilePath() string {
	settingsApp := application.New()
	settings, err := config.ReadDesktopSettings(settingsApp)
	if err == nil && settings.LogDir != "" {
		return filepath.Join(settings.LogDir, "desktop.log")
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "eqt", "desktop.log")
}

func main() {
	// 启动时在后台开始预计算硬件指纹并默默校验本地证书，完全非阻塞，防窗口闪烁
	server.PrecomputeDeviceFingerprints()

	// 如果是 Wails 绑定生成工具的临时执行，强制走 GUI 模式以通过 wails.Run 正常生成绑定并退出
	if strings.Contains(filepath.Base(os.Args[0]), "wailsbindings") {
		startWailsGUI()
		return
	}

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
	defer func() {
		if r := recover(); r != nil {
			crash.SaveDump(r)
			panic(r)
		}
	}()

	// Signal handler: save crash dump on SIGABRT/SIGSEGV
	setupSignalHandler()

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

func checkAndPerformDisasterRollback(fileLogger *FileLogger) bool {
	exePath, err := os.Executable()
	if err != nil {
		return false
	}
	exeOldPath := exePath + ".old"

	// 如果不存在 .old 文件，说明当前并非处于可升级回滚状态，直接跳过
	if _, err := os.Stat(exeOldPath); err != nil {
		return false
	}

	settingsApp := application.New()
	settings, err := config.ReadDesktopSettings(settingsApp)
	if err != nil {
		return false
	}

	currentVer := version.Version()
	// 如果配置中不存在 LastSuccessfulVersion（旧配置兼容）或者两者一致，无需回滚
	if settings.LastSuccessfulVersion == "" || settings.LastSuccessfulVersion == currentVer {
		return false
	}

	// 如果 EQT_AFTER_UPDATE 环境变量为 "1"，代表是刚刚完成二进制替换并拉起的，属于正常升级测试启动阶段
	if os.Getenv("EQT_AFTER_UPDATE") == "1" {
		if fileLogger != nil {
			fileLogger.Info("EQT is starting up for the first time after update. Allowing initialization check.")
		}
		return false
	}

	// 触发回滚灾难恢复逻辑：发生了升级后闪退/崩溃等异常（环境变量消失，但 .old 依然在，且版本号与成功记录不一致）
	if fileLogger != nil {
		fileLogger.Info(fmt.Sprintf("Disaster detected! Current version %s failed to start. Rolling back to %s...", currentVer, settings.LastSuccessfulVersion))
	}

	// 1. 将当前的损坏二进制重命名暂存
	brokenPath := exePath + ".broken"
	_ = os.Remove(brokenPath)
	_ = os.Rename(exePath, brokenPath)

	// 2. 还原旧版备份二进制
	if err := os.Rename(exeOldPath, exePath); err != nil {
		if fileLogger != nil {
			fileLogger.Info(fmt.Sprintf("Disaster rollback failed - cannot restore backup exe: %v", err))
		}
		return false
	}

	// 3. 重新拉起旧版本进程
	cmd := exec.Command(exePath, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		if fileLogger != nil {
			fileLogger.Info(fmt.Sprintf("Disaster rollback failed - failed to restart restored exe: %v", err))
		}
		return false
	}

	if fileLogger != nil {
		fileLogger.Info("Disaster rollback completed successfully. Exiting current broken instance.")
	}
	os.Exit(0)
	return true
}

// setupSignalHandler registers handlers for OS crash signals (SIGABRT, SIGSEGV).
// When one arrives, it saves a crash dump before the process terminates.
// SIGSEGV handling is best-effort (Go runtime behavior varies by platform);
// SIGABRT is reliable for Go fatal errors (concurrent map writes, OOM, etc.).
func setupSignalHandler() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGABRT, syscall.SIGSEGV)
	go func() {
		<-sigCh
		crash.SaveDump(nil) // nil → "crash: SIGABRT or fatal error"
		os.Exit(1)
	}()
}

type safeMultiWriter struct {
	writers []io.Writer
}

func (s safeMultiWriter) Write(p []byte) (n int, err error) {
	for _, w := range s.writers {
		if w != nil {
			_, _ = w.Write(p)
		}
	}
	return len(p), nil
}

func startWailsGUI() {
	// Panic recovery: save crash dump on unexpected panic
	defer func() {
		if r := recover(); r != nil {
			crash.SaveDump(r)
			// Re-panic so the OS crash dialog still appears
			panic(r)
		}
	}()

	// Signal handler: save crash dump on SIGABRT/SIGSEGV
	setupSignalHandler()

	logPath := desktopLogFilePath()
	settingsApp := application.New()
	settings, err := config.ReadDesktopSettings(settingsApp)
	debugLog := false
	if err == nil {
		debugLog = settings.DebugLog || settings.DevMode
	}

	// Always-on baseline file logger (asynchronous, non-blocking, rotating)
	fileLogger := NewFileLogger(logPath, true)
	fileLogger.SetDebugMode(debugLog)
	defer fileLogger.Close()

	// Redirect Go standard library log.Printf / log.Println safely to both os.Stderr and fileLogger.
	// safeMultiWriter ensures that an invalid os.Stderr handle in Windows GUI mode does not abort writing to fileLogger.
	log.SetOutput(safeMultiWriter{writers: []io.Writer{os.Stderr, fileLogger}})

	fileLogger.Info("EQT GUI Starting...")

	// Perform disaster rollback check FIRST before applying offline updates or cleaning files
	if checkAndPerformDisasterRollback(fileLogger) {
		return
	}

	// Apply pending offline update only if in silent mode (or default empty), then restart
	if settings.AutoUpdateMode == "silent" || settings.AutoUpdateMode == "" {
		if server.ApplyOfflineUpdateIfExists() {
			return
		}
	}

	// Create an instance of the app structure
	app := NewApp()
	app.logger = fileLogger
	tray := newTrayController(app)

	// Ensure the entire application strictly connects directly without using any proxy
	_ = os.Unsetenv("http_proxy")
	_ = os.Unsetenv("https_proxy")
	_ = os.Unsetenv("all_proxy")
	_ = os.Unsetenv("HTTP_PROXY")
	_ = os.Unsetenv("HTTPS_PROXY")
	_ = os.Unsetenv("ALL_PROXY")
	if t, ok := http.DefaultTransport.(*http.Transport); ok {
		t.Proxy = nil
	}

	// Instruct WebView2 to disable proxy servers and use direct connections exclusively
	const noProxyArg = "--no-proxy-server"
	if curArgs := os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"); curArgs != "" {
		if !strings.Contains(curArgs, "--no-proxy-server") {
			_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", curArgs+" "+noProxyArg)
		}
	} else {
		_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", noProxyArg)
	}

	// Create application with options
	err = wails.Run(&options.App{
		Title:             "EQT",
		Width:             1120,
		Height:            760,
		MinWidth:          900,
		MinHeight:         640,
		HideWindowOnClose: false,
		Windows: &windows.Options{
			ZoomFactor: 1.0,
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Inject CSP that allows the chat iframe (served by the local agent
			// HTTP server at 127.0.0.1) to load inside this Wails webview.
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Security-Policy",
						"default-src 'self' 'unsafe-inline' 'unsafe-eval'; "+
							"connect-src 'self' http://127.0.0.1:* http://localhost:* https://*.direct.eqt.net.im:* ws: wss:; "+
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
