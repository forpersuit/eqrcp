package config

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"eqrcp/application"
	"eqrcp/util"
	"github.com/eiannone/keyboard"
	"github.com/manifoldco/promptui"
	"github.com/spf13/viper"
)

func scoreInterface(name, ip string) int {
	score := 0
	lowerName := strings.ToLower(name)

	// 0. Prefer the saved interface configuration if it matches
	if viper.GetString("interface") == name {
		score += 1000
	}

	// 1. Name matches (wireless/physical priority)
	if strings.Contains(lowerName, "wlan") || strings.Contains(lowerName, "wi-fi") || strings.Contains(lowerName, "wireless") || strings.Contains(lowerName, "无线") {
		score += 100
	} else if strings.Contains(lowerName, "ethernet") || strings.Contains(lowerName, "以太网") || strings.Contains(lowerName, "eth") || strings.Contains(lowerName, "en") {
		score += 80
	}

	// 2. Name matches (virtual interface penalty)
	if strings.Contains(lowerName, "docker") || strings.Contains(lowerName, "veth") || strings.Contains(lowerName, "wsl") ||
		strings.Contains(lowerName, "virtualbox") || strings.Contains(lowerName, "vmware") || strings.Contains(lowerName, "vpn") ||
		strings.Contains(lowerName, "loopback") || lowerName == "lo" {
		score -= 100
	} else if strings.Contains(lowerName, "vethernet") {
		// Windows Hyper-V/WSL virtual ethernet adapters
		score -= 50
	}

	// 3. IP segment checks
	if strings.HasPrefix(ip, "192.168.") {
		score += 50
	} else if strings.HasPrefix(ip, "10.") {
		score += 30
	} else if strings.HasPrefix(ip, "172.16.") || strings.HasPrefix(ip, "172.17.") || strings.HasPrefix(ip, "172.18.") ||
		strings.HasPrefix(ip, "172.19.") || strings.HasPrefix(ip, "172.20.") || strings.HasPrefix(ip, "172.21.") ||
		strings.HasPrefix(ip, "172.22.") || strings.HasPrefix(ip, "172.23.") || strings.HasPrefix(ip, "172.24.") ||
		strings.HasPrefix(ip, "172.25.") || strings.HasPrefix(ip, "172.26.") || strings.HasPrefix(ip, "172.27.") ||
		strings.HasPrefix(ip, "172.28.") || strings.HasPrefix(ip, "172.29.") || strings.HasPrefix(ip, "172.30.") ||
		strings.HasPrefix(ip, "172.31.") {
		// Docker and internal VM networks commonly use 172.16.0.0/12
		score -= 30
	}

	if ip == "0.0.0.0" || ip == "127.0.0.1" {
		score -= 150
	}

	return score
}

func chooseInterface(flags application.Flags) (string, error) {
	interfaces, err := util.Interfaces(flags.ListAllInterfaces)
	if err != nil {
		return "", err
	}
	if len(interfaces) == 0 {
		return "", errors.New("no interfaces found")
	}

	// Score and sort interfaces
	type ifaceItem struct {
		Name  string
		IP    string
		Score int
	}
	var sorted []ifaceItem
	for name, ip := range interfaces {
		sorted = append(sorted, ifaceItem{
			Name:  name,
			IP:    ip,
			Score: scoreInterface(name, ip),
		})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Score > sorted[j].Score
	})

	defaultIface := sorted[0].Name
	if len(sorted) == 1 {
		return defaultIface, nil
	}

	if !interactive {
		// Non-interactive path, check if TTY and keyboard is available
		if err := keyboard.Open(); err == nil {
			defer keyboard.Close()

			fmt.Printf("EQT 默认使用智能适配网卡: %s (%s)\n", defaultIface, sorted[0].IP)
			fmt.Print("按 [空格键] 切换网卡，或等待 3 秒自动启动...")

			keysEvents, err := keyboard.GetKeys(10)
			if err == nil {
				timer := time.NewTimer(3 * time.Second)
				defer timer.Stop()

				hasSpace := false
			loop:
				for {
					select {
					case <-timer.C:
						break loop
					case ev := <-keysEvents:
						if ev.Err != nil {
							break loop
						}
						if ev.Key == keyboard.KeySpace || ev.Rune == ' ' {
							hasSpace = true
							break loop
						}
						if ev.Key == keyboard.KeyEnter {
							break loop
						}
						if ev.Key == keyboard.KeyCtrlC {
							return "", errors.New("aborted by user")
						}
					}
				}
				fmt.Println()
				if hasSpace {
					goto selectMenu
				}
			}
			return defaultIface, nil
		} else {
			// Non-interactive terminal (e.g. background daemon)
			return defaultIface, nil
		}
	}

selectMenu:
	// Map for pretty printing
	m := make(map[string]string)
	var items []string
	for _, item := range sorted {
		label := fmt.Sprintf("%s (%s)", item.Name, item.IP)
		m[label] = item.Name
		items = append(items, label)
	}
	// Add the "any" interface
	anyIP := "0.0.0.0"
	anyName := "any"
	anyLabel := fmt.Sprintf("%s (%s)", anyName, anyIP)
	m[anyLabel] = anyName
	items = append(items, anyLabel)

	prompt := promptui.Select{
		Items: items,
		Label: "Choose interface",
	}
	_, result, err := prompt.Run()
	if err != nil {
		return "", err
	}
	return m[result], nil
}
