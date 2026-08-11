package util

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/jhoonb/archivex"
)

// --- Trace ID for request-level tracing (§7.1) ---
// Generated once per process, reused across all outgoing HTTP requests.

var (
	traceIDOnce sync.Once
	traceIDVal  string
)

// TraceID returns the process-wide trace ID (UUID v4), generating it on first call.
func TraceID() string {
	traceIDOnce.Do(func() {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			traceIDVal = fmt.Sprintf("fallback-%d", time.Now().UnixNano())
			return
		}
		// Set UUID v4 bits
		b[6] = (b[6] & 0x0f) | 0x40
		b[8] = (b[8] & 0x3f) | 0x80
		traceIDVal = fmt.Sprintf("%08x-%04x-4%03x-%04x-%012x",
			b[0:4], b[4:6], b[6:7], b[8:10], b[10:16])
	})
	return traceIDVal
}

// Expand tilde in paths
func Expand(input string) string {
	if runtime.GOOS == "windows" {
		return input
	}
	usr, _ := user.Current()
	dir := usr.HomeDir
	if input == "~" {
		input = dir
	} else if strings.HasPrefix(input, "~/") {
		input = filepath.Join(dir, input[2:])
	}
	return input
}

// ZipFiles and return the resulting zip's filename
func ZipFiles(files []string) (string, error) {
	zip := new(archivex.ZipFile)
	tmpfile, err := os.CreateTemp("", "eqt")
	if err != nil {
		return "", err
	}
	tmpfile.Close()
	if err := os.Rename(tmpfile.Name(), tmpfile.Name()+".zip"); err != nil {
		return "", err
	}
	tmpfile, err = os.OpenFile(tmpfile.Name()+".zip", os.O_RDWR, 0644)
	if err != nil {
		return "", err
	}
	if err := zip.CreateWriter(tmpfile.Name(), tmpfile); err != nil {
		return "", err
	}

	for _, filename := range files {
		fileinfo, err := os.Stat(filename)
		if err != nil {
			return "", err
		}
		if fileinfo.IsDir() {
			if err := zip.AddAll(filename, true); err != nil {
				return "", err
			}
		} else {
			file, err := os.Open(filename)
			if err != nil {
				return "", err
			}
			addErr := zip.Add(filename, file, fileinfo)
			file.Close()
			if addErr != nil {
				return "", addErr
			}
		}
	}

	if err := zip.Writer.Close(); err != nil {
		return "", err
	}
	if err := tmpfile.Close(); err != nil {
		return "", err
	}

	return zip.Name, nil
}

// GetRandomURLPath returns an unguessable URL-safe path segment.
func GetRandomURLPath() (string, error) {
	randbytes := make([]byte, 18)
	if _, err := io.ReadFull(rand.Reader, randbytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(randbytes), nil
}

// GetSessionID returns a base64 encoded string of 40 random characters
func GetSessionID() (string, error) {
	randbytes := make([]byte, 40)
	if _, err := io.ReadFull(rand.Reader, randbytes); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(randbytes), nil
}

// GetInterfaceAddress returns the address of the network interface to
// bind the server to. If the interface is "any", it will return 0.0.0.0.
// If no interface is found with that name, an error is returned
func GetInterfaceAddress(ifaceString string) (string, error) {
	if ifaceString == "any" {
		return "0.0.0.0", nil
	}
	if ifaceString == "loopback" {
		return "127.0.0.1", nil
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}
	var candidateInterface *net.Interface
	for _, iface := range ifaces {
		if iface.Name == ifaceString {
			candidateInterface = &iface
			break
		}
	}
	if candidateInterface != nil {
		ip, err := FindIP(*candidateInterface)
		if err != nil {
			return "", err
		}
		return ip, nil
	}
	return "", errors.New("unable to find interface")
}

// FindIP returns the IP address of the passed interface, and an error
func FindIP(iface net.Interface) (string, error) {
	var ip string
	addrs, err := iface.Addrs()
	if err != nil {
		return "", err
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok {
			if ipnet.IP.IsLinkLocalUnicast() {
				continue
			}
			if ipnet.IP.To4() != nil {
				ip = ipnet.IP.String()
				continue
			}
			// Use IPv6 only if an IPv4 hasn't been found yet.
			// This is eventually overwritten with an IPv4, if found (see above)
			if ip == "" {
				ip = "[" + ipnet.IP.String() + "]"
			}
		}
	}
	if ip == "" {
		return "", errors.New("unable to find an IP for this interface")
	}
	return ip, nil
}

// ReadFilenames from dir
func ReadFilenames(dir string) ([]string, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	// Create array of names of files which are stored in dir
	// used later to set valid name for received files
	filenames := make([]string, 0, len(files))
	for _, fi := range files {
		filenames = append(filenames, fi.Name())
	}
	return filenames, nil
}
