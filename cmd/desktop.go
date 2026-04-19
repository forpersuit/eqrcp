package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var desktopCmd = &cobra.Command{
	Use:   "desktop",
	Short: "Desktop integration helpers",
	Long:  "Desktop integration helpers for file manager context menus and other non-terminal launchers.",
}

var desktopShareCmd = &cobra.Command{
	Use:   "share <file-or-directory> [file-or-directory...]",
	Short: "Share selected files or directories from a desktop launcher",
	Long:  "Share selected files or directories from a desktop launcher. This command opens the QR code in a browser by default.",
	Example: `# Share one file from a desktop launcher
eqrcp desktop share /path/file.txt
# Share multiple selected paths
eqrcp desktop share /path/file.txt /path/photo.jpg
# Share a directory
eqrcp desktop share /path/directory`,
	Args: cobra.MinimumNArgs(1),
	RunE: func(command *cobra.Command, args []string) error {
		app.Flags.Browser = true
		return sendCmdFunc(command, args)
	},
}

var desktopReceiveCmd = &cobra.Command{
	Use:   "receive <directory>",
	Short: "Receive files into a directory from a desktop launcher",
	Long:  "Receive files into a directory from a desktop launcher. This command opens the QR code in a browser by default.",
	Example: `# Receive files into a selected directory
eqrcp desktop receive /path/directory`,
	Args: cobra.ExactArgs(1),
	RunE: func(command *cobra.Command, args []string) error {
		app.Flags.Browser = true
		app.Flags.Output = args[0]
		return receiveCmdFunc(command, args)
	},
}

var desktopInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install desktop context menu entries",
	Long:  "Install desktop context menu entries for the current user.",
	RunE: func(command *cobra.Command, args []string) error {
		if err := installDesktopIntegration(); err != nil {
			return err
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop context menu entries installed.")
		return nil
	},
}

var desktopUninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Uninstall desktop context menu entries",
	Long:  "Uninstall desktop context menu entries created by eqrcp.",
	RunE: func(command *cobra.Command, args []string) error {
		if err := uninstallDesktopIntegration(); err != nil {
			return err
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop context menu entries uninstalled.")
		return nil
	},
}
