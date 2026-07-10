package cmd

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"eqt/pkg/application"
	"eqt/pkg/chat/v2/diag"
	"eqt/pkg/config"
	"eqt/pkg/logger"
	"eqt/pkg/qr"
	"eqt/pkg/server"
	"github.com/eiannone/keyboard"
	"github.com/spf13/cobra"
)

func chatCmdFunc(command *cobra.Command, args []string) error {
	settingsApp := application.New()
	settings, err := config.ReadDesktopSettings(settingsApp)
	debugLogEnabled := false
	if err == nil {
		debugLogEnabled = settings.DebugLog || settings.DevMode
	}

	var log logger.Logger
	var logFile *os.File
	if debugLogEnabled {
		logDir := filepath.Join(os.TempDir(), "eqt")
		if cacheDir, err := os.UserCacheDir(); err == nil {
			logDir = filepath.Join(cacheDir, "eqt")
		}
		_ = os.MkdirAll(logDir, 0755)
		logFile, err = os.OpenFile(filepath.Join(logDir, "cli.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err == nil {
			log = logger.NewWithWriter(app.Flags.Quiet, logFile)
		} else {
			log = logger.New(app.Flags.Quiet)
		}
	} else {
		log = logger.New(app.Flags.Quiet)
	}
	if logFile != nil {
		defer logFile.Close()
	}

	cfg, err := config.New(app)
	if err != nil {
		return err
	}
	srv, err := server.New(&cfg)
	if err != nil {
		return err
	}
	if debugLogEnabled && logFile != nil {
		srv.ChatV2Logger = diag.NewStdLoggerWithWriter(io.MultiWriter(os.Stderr, logFile))
	} else {
		srv.ChatV2Logger = diag.NewStdLogger()
	}
	srv.ChatDebug = debugLogEnabled

	log.Print(`Scan the following URL with a QR reader to join the chat session, press CTRL+C or "q" to exit:`)
	log.Print(srv.ChatJoinURL())
	if err := qr.RenderString(srv.ChatJoinURL(), cfg.Reversed); err != nil {
		return err
	}
	// Default to displaying chat in browser, fallback to command line mode if browser opening fails (e.g. headless environment)
	if err := srv.DisplayChat(); err != nil {
		if err := srv.Chat(); err != nil {
			return err
		}
	}
	if err := keyboard.Open(); err == nil {
		defer func() {
			keyboard.Close()
		}()
		go func() {
			for {
				char, key, _ := keyboard.GetKey()
				if string(char) == "q" || key == keyboard.KeyCtrlC {
					srv.Shutdown()
				}
			}
		}()
	} else {
		log.Print(fmt.Sprintf("Warning: keyboard not detected: %v", err))
	}
	return srv.Wait()
}

var chatCmd = &cobra.Command{
	Use:     "chat",
	Short:   "Start a browser chat session with another device",
	Long:    "Start a browser chat session where this host and a scanned mobile device can exchange text and attachments.",
	Aliases: []string{"c"},
	Example: `# Start a chat session and print a QR code
eqt chat
# Start a chat session and open the desktop browser interface
eqt chat --browser`,
	Args: cobra.NoArgs,
	RunE: chatCmdFunc,
}
