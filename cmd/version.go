package cmd

import (
	"fmt"

	"eqt/pkg/version"
	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version number and build information.",
	Run: func(c *cobra.Command, args []string) {
		fmt.Println(version.String())
	},
}
