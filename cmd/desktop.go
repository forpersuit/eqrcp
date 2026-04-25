package cmd

import (
	"fmt"

	"eqrcp/application"
	"eqrcp/config"
	"eqrcp/version"
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
		app.Flags.Browser = desktopBrowserPreference(app.Flags, true)
		return sendCmdFunc(command, args)
	},
}

var desktopReceiveCmd = &cobra.Command{
	Use:   "receive [directory]",
	Short: "Receive files into a directory from a desktop launcher",
	Long:  "Receive files into a directory from a desktop launcher. This command opens the QR code in a browser by default. When no directory is passed, the configured output directory or current working directory is used.",
	Example: `# Receive files into a selected directory
eqrcp desktop receive /path/directory
# Receive files into the configured output directory or current directory
eqrcp desktop receive`,
	Args: cobra.RangeArgs(0, 1),
	RunE: func(command *cobra.Command, args []string) error {
		app.Flags.Browser = desktopBrowserPreference(app.Flags, true)
		if output, ok := desktopReceiveOutput(args); ok {
			app.Flags.Output = output
		} else if app.Flags.Output == "" {
			app.Flags.Output = desktopOutputPreference(app.Flags)
		}
		return receiveCmdFunc(command, args)
	},
}

func desktopReceiveOutput(args []string) (string, bool) {
	if len(args) == 0 {
		return "", false
	}
	return args[0], true
}

func desktopBrowserPreference(flags application.Flags, fallback bool) bool {
	settingsApp := application.New()
	settingsApp.Flags = flags
	settings, err := config.ReadDesktopSettings(settingsApp)
	if err != nil {
		return fallback
	}
	return settings.Browser
}

func desktopOutputPreference(flags application.Flags) string {
	settingsApp := application.New()
	settingsApp.Flags = flags
	settings, err := config.ReadDesktopSettings(settingsApp)
	if err != nil || settings.Output == "" {
		return config.DefaultDesktopOutputDirectory()
	}
	return settings.Output
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

var desktopStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show desktop context menu integration status",
	Long:  "Show desktop context menu integration status for the current user.",
	RunE: func(command *cobra.Command, args []string) error {
		status, err := desktopIntegrationStatus()
		if err != nil {
			return err
		}
		fmt.Fprintf(command.OutOrStdout(), "%s\n%s", version.String(), status)
		return nil
	},
}

var desktopStartupEnableCmd = &cobra.Command{
	Use:   "startup-enable",
	Short: "Start the desktop agent at login",
	Long:  "Register the desktop integration agent to start when the current user logs in.",
	RunE: func(command *cobra.Command, args []string) error {
		if err := installDesktopStartup(); err != nil {
			return err
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop agent startup enabled.")
		return nil
	},
}

var desktopStartupDisableCmd = &cobra.Command{
	Use:   "startup-disable",
	Short: "Stop starting the desktop agent at login",
	Long:  "Remove the current-user login startup registration for the desktop integration agent.",
	RunE: func(command *cobra.Command, args []string) error {
		if err := uninstallDesktopStartup(); err != nil {
			return err
		}
		fmt.Fprintln(command.OutOrStdout(), "Desktop agent startup disabled.")
		return nil
	},
}

var desktopStartupStatusCmd = &cobra.Command{
	Use:   "startup-status",
	Short: "Show desktop agent startup status",
	Long:  "Show whether the desktop integration agent is registered to start when the current user logs in.",
	RunE: func(command *cobra.Command, args []string) error {
		status, err := desktopStartupStatus()
		if err != nil {
			return err
		}
		fmt.Fprintf(command.OutOrStdout(), "%s\n%s", version.String(), status)
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
