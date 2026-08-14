package config

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"eqt/pkg/application"
)

func TestNew(t *testing.T) {
	os.Clearenv()
	_, f, _, _ := runtime.Caller(0)
	foundIface, err := chooseInterface(application.Flags{})
	if err != nil {
		panic(err)
	}
	testdir := filepath.Join(filepath.Dir(f), "testdata")
	tempfile, err := os.CreateTemp("", "eqt*tmp.yml")
	if err != nil {
		t.Skip()
	}
	defer os.Remove(tempfile.Name())
	partialconfig, err := os.CreateTemp("", "eqt*partial.yml")
	if err != nil {
		panic(err)
	}
	defer os.Remove(partialconfig.Name())
	if err := os.WriteFile(partialconfig.Name(), []byte(`port: 9090`), os.ModePerm); err != nil {
		panic(err)
	}
	eqtData, _ := os.ReadFile(filepath.Join(testdir, "eqt.yml"))
	eqtTemp, err := os.CreateTemp("", "eqt*eqt.yml")
	if err != nil {
		t.Skip()
	}
	defer os.Remove(eqtTemp.Name())
	_ = os.WriteFile(eqtTemp.Name(), eqtData, os.ModePerm)

	fullData, _ := os.ReadFile(filepath.Join(testdir, "full.yml"))
	fullTemp, err := os.CreateTemp("", "eqt*full.yml")
	if err != nil {
		t.Skip()
	}
	defer os.Remove(fullTemp.Name())
	_ = os.WriteFile(fullTemp.Name(), fullData, os.ModePerm)

	fullOverridesTemp, err := os.CreateTemp("", "eqt*full_overrides.yml")
	if err != nil {
		t.Skip()
	}
	defer os.Remove(fullOverridesTemp.Name())
	_ = os.WriteFile(fullOverridesTemp.Name(), fullData, os.ModePerm)

	type args struct {
		app application.App
	}
	tests := []struct {
		name string
		args args
		want Config
	}{
		{
			"partial", args{
				app: application.App{
					Flags: application.Flags{
						Config: partialconfig.Name(),
					},
				},
			},
			Config{
				Interface: foundIface,
				Port:      9090,
			},
		},
		{
			"init", args{
				app: application.App{
					Flags: application.Flags{
						Config: tempfile.Name(),
					},
				},
			},
			Config{
				Interface: foundIface,
			},
		},
		{
			"#2", args{
				app: application.App{
					Flags: application.Flags{
						Config: eqtTemp.Name(),
					},
				},
			},
			Config{
				Interface: foundIface,
			},
		},
		{
			"#2", args{
				app: application.App{
					Flags: application.Flags{
						Config: fullTemp.Name(),
					},
				},
			},
			Config{
				Interface: foundIface,
				Port:      18080,
				KeepAlive: false,
				Bind:      "10.20.30.40",
				Path:      "random",
				Secure:    false,
				TlsKey:    "/path/to/key",
				TlsCert:   "/path/to/cert",
				FQDN:      "mylan.com",
				Output:    "/path/to/default/output/dir",
				Reversed:  true,
			},
		},
		{
			"overrides", args{
				app: application.App{
					Flags: application.Flags{
						Config: fullOverridesTemp.Name(),
						Port:   99999,
					},
				},
			},
			Config{
				Interface: foundIface,
				Port:      99999,
				Bind:      "10.20.30.40",
				KeepAlive: false,
				Path:      "random",
				Secure:    false,
				TlsKey:    "/path/to/key",
				TlsCert:   "/path/to/cert",
				FQDN:      "mylan.com",
				Output:    "/path/to/default/output/dir",
				Reversed:  true,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.args.app)
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			got.Interface = foundIface
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("New() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDefaultConfigFileUsesLocalEQTDirectory(t *testing.T) {
	got := filepath.ToSlash(DefaultConfigFile())
	if !strings.HasSuffix(got, "/.local/eqt/config.yml") {
		t.Fatalf("DefaultConfigFile() = %q, want ~/.local/eqt/config.yml", got)
	}
}

func TestNewReadsMode(t *testing.T) {
	configFile, err := os.CreateTemp("", "eqt*mode.yml")
	if err != nil {
		t.Skip()
	}
	defer os.Remove(configFile.Name())
	if err := os.WriteFile(configFile.Name(), []byte("mode: dev\n"), os.ModePerm); err != nil {
		t.Fatal(err)
	}

	cfg, err := New(application.App{Flags: application.Flags{Config: configFile.Name()}})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Mode != "dev" {
		t.Fatalf("Mode = %q, want dev", cfg.Mode)
	}
}
