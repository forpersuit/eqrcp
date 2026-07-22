package cmd

import (
	"eqt/pkg/config"
	"github.com/spf13/cobra"
)

func configCmdFunc(command *cobra.Command, args []string) error {
	return config.Wizard(app)
}

var configCmd = &cobra.Command{
	Use:     "config",
	Short:   "Configure eqt",
	Long:    "Run an interactive configuration wizard for eqt. With this command you can configure which network interface and port should be used to create the file server.",
	Aliases: []string{"c", "cfg"},
	RunE:    configCmdFunc,
}

