package cmd

import (
	"fmt"

	"eqt/pkg/config"
	"eqt/pkg/logger"
	"eqt/pkg/qr"
	"eqt/pkg/server"
	"github.com/eiannone/keyboard"
	"github.com/spf13/cobra"
)

func chatCmdFunc(command *cobra.Command, args []string) error {
	log := logger.New(app.Flags.Quiet)
	cfg, err := config.New(app)
	if err != nil {
		return err
	}
	srv, err := server.New(&cfg)
	if err != nil {
		return err
	}
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
