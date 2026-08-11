//go:build windows

package util

import (
	"syscall"
	"unsafe"
)

// GetDiskFreeSpace returns the free bytes available on the partition containing the given path.
func GetDiskFreeSpace(path string) (uint64, error) {
	kernel32 := syscall.MustLoadDLL("kernel32.dll")
	getDiskFreeSpaceEx := kernel32.MustFindProc("GetDiskFreeSpaceExW")

	uPath, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}

	var freeBytesAvailable uint64
	var totalNumberOfBytes uint64
	var totalNumberOfFreeBytes uint64

	r1, _, err := getDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(uPath)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalNumberOfBytes)),
		uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
	)
	if r1 == 0 {
		return 0, err
	}
	return freeBytesAvailable, nil
}
