//go:build windows
// +build windows

package server

import (
	"strings"
	"syscall"

	"github.com/yusufpapurcu/wmi"
)

func init() {
	hideWindowAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

type win32ComputerSystemProduct struct {
	UUID string
}

type win32Processor struct {
	ProcessorId string
}

type win32DiskDrive struct {
	Index        int
	SerialNumber string
}

// queryWindowsBoardUUID reads the motherboard UUID via WMI COM directly.
// Win32_ComputerSystemProduct.UUID is a real hardware UUID that survives OS
// reinstall, unlike the MachineGuid registry value. No PowerShell/wmic child
// processes are spawned (Defender Behavior:Win32/DefenseEvasion.A!ml trigger).
func queryWindowsBoardUUID() string {
	var dst []win32ComputerSystemProduct
	if err := wmi.Query("SELECT UUID FROM Win32_ComputerSystemProduct", &dst); err != nil || len(dst) == 0 {
		return ""
	}
	return strings.TrimSpace(dst[0].UUID)
}

// queryWindowsCPUSerial reads the CPU Processor ID via WMI COM directly.
func queryWindowsCPUSerial() string {
	var dst []win32Processor
	if err := wmi.Query("SELECT ProcessorId FROM Win32_Processor", &dst); err != nil || len(dst) == 0 {
		return ""
	}
	return strings.TrimSpace(dst[0].ProcessorId)
}

// queryWindowsDiskSerial reads the system physical disk serial number (index 0)
// via WMI COM directly.
func queryWindowsDiskSerial() string {
	var dst []win32DiskDrive
	if err := wmi.Query("SELECT Index, SerialNumber FROM Win32_DiskDrive", &dst); err != nil {
		return ""
	}
	for _, drive := range dst {
		if drive.Index == 0 {
			return strings.TrimSpace(drive.SerialNumber)
		}
	}
	if len(dst) > 0 {
		return strings.TrimSpace(dst[0].SerialNumber)
	}
	return ""
}
