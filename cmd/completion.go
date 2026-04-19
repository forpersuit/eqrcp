package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

// completionCmd represents the completion command
var completionCmd = &cobra.Command{
	Use:   "completion [bash|zsh|fish|powershell]",
	Short: "Generate completion script",
	Long: `To load completions:

Bash:

$ source <(eqrcp completion bash)

# To load completions for each session, execute once:
Linux:
  $ eqrcp completion bash > /etc/bash_completion.d/eqrcp
MacOS:
  $ eqrcp completion bash > /usr/local/etc/bash_completion.d/eqrcp

Zsh:

# If shell completion is not already enabled in your environment you will need
# to enable it.  You can execute the following once:

$ echo "autoload -U compinit; compinit" >> ~/.zshrc

# To load completions for each session, execute once:
$ eqrcp completion zsh > "${fpath[1]}/_eqrcp"

# You will need to start a new shell for this setup to take effect.

Fish:

$ eqrcp completion fish | source

# To load completions for each session, execute once:
$ eqrcp completion fish > ~/.config/fish/completions/eqrcp.fish
`,
	DisableFlagsInUseLine: true,
	ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
	Args:                  cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
	RunE: func(cmd *cobra.Command, args []string) error {
		switch args[0] {
		case "bash":
			if err := cmd.Root().GenBashCompletion(os.Stdout); err != nil {
				return err
			}
		case "zsh":
			if err := cmd.Root().GenZshCompletion(os.Stdout); err != nil {
				return err
			}
		case "fish":
			if err := cmd.Root().GenFishCompletion(os.Stdout, true); err != nil {
				return err
			}
		case "powershell":
			if err := cmd.Root().GenPowerShellCompletion(os.Stdout); err != nil {
				return err
			}
		}
		return nil
	},
}
