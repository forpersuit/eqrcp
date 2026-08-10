//go:build !windows

package util

import (
	"syscall"
)

// GetDiskFreeSpace returns the free bytes available on the partition containing the given path.
func GetDiskFreeSpace(path string) (uint64, error) {
	var stat syscall.Statfs_t
	err := syscall.Statfs(path, &stat)
	if err != nil {
		return 0, err
	}
	return uint64(stat.Bavail) * uint64(stat.Bsize), nil
}
