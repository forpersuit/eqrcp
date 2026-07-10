package main

import (
	"context"
	"embed"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	wailslogger "github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"golang.org/x/term"

	"eqt/cmd"
	"eqt/pkg/application"
	"eqt/pkg/config"
	"eqt/pkg/server"
	"eqt/pkg/version"
	"os/exec"
)

//go:embed all:frontend/dist
var assets embed.FS

type FileLogger struct {
	mu      sync.RWMutex
	file    *os.File
	enabled bool
}

func NewFileLogger(filePath string, enabled bool) *FileLogger {
	_ = os.MkdirAll(filepath.Dir(filePath), 0755)
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return &FileLogger{enabled: false}
	}
	return &FileLogger{file: f, enabled: enabled}
}

func (l *FileLogger) SetEnabled(enabled bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.enabled = enabled
}

func (l *FileLogger) Enabled() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.enabled
}

func (l *FileLogger) Write(p []byte) (n int, err error) {
	if l.Enabled() && l.file != nil {
		return l.file.Write(p)
	}
	return len(p), nil
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
	if l.Enabled() && l.file != nil {
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

func startWailsGUI() {
	logPath := desktopLogFilePath()
	
	settingsApp := application.New()
	settings, err := config.ReadDesktopSettings(settingsApp)
	enabled := false
	if err == nil {
		enabled = settings.DebugLog || settings.DevMode
	}
	
	fileLogger := NewFileLogger(logPath, enabled)
	defer fileLogger.Close()

	fileLogger.Info("EQT GUI Starting...")

	// Perform disaster rollback check FIRST before applying offline updates or cleaning files
	if checkAndPerformDisasterRollback(fileLogger) {
		return
	}

	// Apply pending offline update if exists, then restart
	if server.ApplyOfflineUpdateIfExists() {
		return
	}

	// Create an instance of the app structure
	app := NewApp()
	app.logger = fileLogger
	tray := newTrayController(app)

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
