package cmd

import (
	"fmt"

	"eqrcp/body"
	"eqrcp/config"
	"eqrcp/logger"
	"eqrcp/qr"
	"github.com/eiannone/keyboard"

	"eqrcp/server"
	"github.com/spf13/cobra"
)

func sendCmdFunc(command *cobra.Command, args []string) error {
	log := logger.New(app.Flags.Quiet)
	body, err := body.FromArgs(args, app.Flags.Zip)
	if err != nil {
		return err
	}
	cfg, err := config.New(app)
	if err != nil {
		return err
	}
	srv, err := server.New(&cfg)
	if err != nil {
		return err
	}
	// Sets the body
	srv.Send(body)
	log.Print(`Scan the following URL with a QR reader to open the download page, press CTRL+C or "q" to exit:`)
	log.Print(srv.SendURL)
	if err := qr.RenderString(srv.SendURL, cfg.Reversed); err != nil {
		return err
	}
	if app.Flags.Browser {
		if err := srv.DisplayQR(srv.SendURL); err != nil {
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
	if err := srv.Wait(); err != nil {
		return err
	}
	return nil
}

var sendCmd = &cobra.Command{
	Use:     "send",
	Short:   "Send a file(s) or directories from this host",
	Long:    "Send a file(s) or directories from this host",
	Aliases: []string{"s"},
	Example: `# Send /path/file.gif. Webserver listens on a random port
eqrcp send /path/file.gif
# Shorter version:
eqrcp /path/file.gif
# Zip file1.gif and file2.gif, then send the zip package
eqrcp /path/file1.gif /path/file2.gif
# Zip the content of directory, then send the zip package
eqrcp /path/directory
# Send file.gif by creating a webserver on port 8080
eqrcp --port 8080 /path/file.gif
`,
	Args: cobra.MinimumNArgs(1),
	RunE: sendCmdFunc,
}
