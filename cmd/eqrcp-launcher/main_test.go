package main

import "testing"

func TestParseArgsWithExplicitEqrcpExe(t *testing.T) {
	exe, args := parseArgs([]string{"--eqrcp-exe", `C:\Tools\renamed.exe`, "share", `C:\tmp\a.txt`})
	if exe != `C:\Tools\renamed.exe` {
		t.Fatalf("parseArgs() exe = %q", exe)
	}
	if len(args) != 2 || args[0] != "share" || args[1] != `C:\tmp\a.txt` {
		t.Fatalf("parseArgs() args = %#v", args)
	}
}

func TestParseArgsWithoutExplicitEqrcpExe(t *testing.T) {
	exe, args := parseArgs([]string{"receive", `C:\tmp`})
	if exe != "" {
		t.Fatalf("parseArgs() exe = %q, want empty", exe)
	}
	if len(args) != 2 || args[0] != "receive" || args[1] != `C:\tmp` {
		t.Fatalf("parseArgs() args = %#v", args)
	}
}
