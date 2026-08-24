package cmd

import (
	"errors"

	"github.com/spf13/cobra"
)

func chatCmdFunc(command *cobra.Command, args []string) error {
	return errors.New("chat mode is an exclusive feature of the EQT Desktop GUI application and cannot be started from command-line interface. Please launch EQT Desktop to use Chat.")
}

var chatCmd = &cobra.Command{
	Use:     "chat",
	Short:   "Chat mode is exclusively available in EQT Desktop GUI",
	Long:    "Chat mode is an exclusive feature of the EQT Desktop GUI application and cannot be started from the command-line interface.",
	Aliases: []string{"c"},
	Args:    cobra.NoArgs,
	RunE:    chatCmdFunc,
}
