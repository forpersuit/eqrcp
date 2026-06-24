package util

import (
	"net"
	"regexp"

	externalip "github.com/glendc/go-external-ip"
)

// Interfaces returns a `name:ip` map of the suitable interfaces found
func Interfaces(listAll bool) (map[string]string, error) {
	names := make(map[string]string)
	ifaces, err := net.Interfaces()
	if err != nil {
		return names, err
	}
	var re = regexp.MustCompile(`^(veth|br\-|docker|lo|EHC|XHC|bridge|gif|stf|p2p|awdl|utun|tun|tap)`)
	for _, iface := range ifaces {
		if !listAll && re.MatchString(iface.Name) {
			continue
		}
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		ip, err := FindIP(iface)
		if err != nil {
			continue
		}
		names[iface.Name] = ip
	}
	return names, nil
}

// GetExternalIP of this host
func GetExternalIP() (net.IP, error) {
	// 1. Try dialing a public DNS server via UDP to get the local interface IP that has an internet route.
	// This is instant (under 0.1ms), does not send any packets, and works offline if default gateway is present.
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		localAddr := conn.LocalAddr().(*net.UDPAddr)
		ip := localAddr.IP
		if ip != nil && !ip.IsLoopback() && !ip.IsUnspecified() {
			return ip, nil
		}
	}

	// 2. Fallback: Scan active local network interfaces to find a valid non-loopback IPv4 address.
	// This works 100% offline.
	ifaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range ifaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				continue
			}
			for _, addr := range addrs {
				var ip net.IP
				switch v := addr.(type) {
				case *net.IPNet:
					ip = v.IP
				case *net.IPAddr:
					ip = v.IP
				}
				if ip != nil && !ip.IsLoopback() && ip.To4() != nil {
					return ip, nil
				}
			}
		}
	}

	// 3. Last fallback: Query external consensus engine (could be slow or fail offline)
	consensus := externalip.DefaultConsensus(nil, nil)
	ip, err := consensus.ExternalIP()
	if err != nil {
		return nil, err
	}
	return ip, nil
}
