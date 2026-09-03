package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/miekg/dns"
)

var (
	flagListenIP = flag.String("listen", "", "IP to bind for DNS (empty for all interfaces)")
	flagDNSPort  = flag.Int("port", 53, "DNS UDP/TCP listen port")
	flagHTTPPort = flag.Int("http-port", 5380, "Management HTTP listen port")
	flagDomain   = flag.String("domain", "direct.eqt.net.im", "Base domain to handle")
	flagToken    = flag.String("token", "", "Bearer token for management HTTP API")
	flagNS1      = flag.String("ns1", "ns1.eqt.net.im.", "Primary nameserver")
	flagNS2      = flag.String("ns2", "ns2.eqt.net.im.", "Secondary nameserver")
	flagSOAMName = flag.String("soa-mname", "ns1.eqt.net.im.", "SOA primary master")
	flagSOARName = flag.String("soa-rname", "admin.eqt.net.im.", "SOA administrator email")
)

// AcmeStore holds active ACME TXT challenges safely in memory.
type AcmeStore struct {
	mu     sync.RWMutex
	values map[string]time.Time
}

func newAcmeStore() *AcmeStore {
	return &AcmeStore{
		values: make(map[string]time.Time),
	}
}

func (s *AcmeStore) Set(val string, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[val] = time.Now().Add(ttl)
}

func (s *AcmeStore) Delete(val string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, val)
}

func (s *AcmeStore) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values = make(map[string]time.Time)
}

func (s *AcmeStore) GetAll() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	var res []string
	for v, exp := range s.values {
		if exp.After(now) {
			res = append(res, v)
		} else {
			delete(s.values, v)
		}
	}
	return res
}

// Regex to capture dashed IPv4: exactly 4 numbers separated by hyphens.
var (
	reDashedExact = regexp.MustCompile(`(?:^|[^0-9])([0-9]{1,3})-([0-9]{1,3})-([0-9]{1,3})-([0-9]{1,3})$`)
)

func parseIP(domain string) net.IP {
	clean := strings.TrimSuffix(strings.ToLower(domain), ".")
	parts := strings.Split(clean, ".")

	for i := 0; i < len(parts); i++ {
		label := parts[i]
		if m := reDashedExact.FindStringSubmatch(label); len(m) == 5 {
			if ip := validateAndBuildIP(m[1], m[2], m[3], m[4]); ip != nil {
				return ip
			}
		}
		if i+3 < len(parts) {
			if ip := validateAndBuildIP(parts[i], parts[i+1], parts[i+2], parts[i+3]); ip != nil {
				return ip
			}
		}
	}

	return nil
}

func validateAndBuildIP(s1, s2, s3, s4 string) net.IP {
	b1, err1 := strconv.Atoi(s1)
	b2, err2 := strconv.Atoi(s2)
	b3, err3 := strconv.Atoi(s3)
	b4, err4 := strconv.Atoi(s4)
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		return nil
	}
	if b1 < 0 || b1 > 255 || b2 < 0 || b2 > 255 || b3 < 0 || b3 > 255 || b4 < 0 || b4 > 255 {
		return nil
	}
	return net.IPv4(byte(b1), byte(b2), byte(b3), byte(b4))
}

type DNSHandler struct {
	baseDomain string
	store      *AcmeStore
	ns1        string
	ns2        string
	soaMName   string
	soaRName   string
}

func (h *DNSHandler) ServeDNS(w dns.ResponseWriter, r *dns.Msg) {
	m := new(dns.Msg)
	m.SetReply(r)
	m.Authoritative = true

	if len(r.Question) == 0 {
		_ = w.WriteMsg(m)
		return
	}

	q := r.Question[0]
	qName := strings.ToLower(q.Name)
	cleanBase := strings.ToLower(strings.TrimSuffix(h.baseDomain, ".")) + "."

	log.Printf("[DNS] Query from %s: %s (type %s)", w.RemoteAddr(), qName, dns.TypeToString[q.Qtype])

	if !strings.HasSuffix(qName, cleanBase) && qName != cleanBase {
		m.Rcode = dns.RcodeRefused
		_ = w.WriteMsg(m)
		return
	}

	switch q.Qtype {
	case dns.TypeA:
		ip := parseIP(qName)
		if ip != nil {
			m.Answer = append(m.Answer, &dns.A{
				Hdr: dns.RR_Header{
					Name:   q.Name,
					Rrtype: dns.TypeA,
					Class:  dns.ClassINET,
					Ttl:    300,
				},
				A: ip.To4(),
			})
		} else {
			m.Rcode = dns.RcodeNameError // NXDOMAIN
		}

	case dns.TypeTXT:
		if strings.HasPrefix(qName, "_acme-challenge.") {
			challenges := h.store.GetAll()
			for _, val := range challenges {
				m.Answer = append(m.Answer, &dns.TXT{
					Hdr: dns.RR_Header{
						Name:   q.Name,
						Rrtype: dns.TypeTXT,
						Class:  dns.ClassINET,
						Ttl:    60,
					},
					Txt: []string{val},
				})
			}
			if len(challenges) == 0 {
				m.Rcode = dns.RcodeSuccess // NOERROR empty
			}
		} else {
			m.Rcode = dns.RcodeNameError
		}

	case dns.TypeNS:
		m.Answer = append(m.Answer,
			&dns.NS{
				Hdr: dns.RR_Header{Name: cleanBase, Rrtype: dns.TypeNS, Class: dns.ClassINET, Ttl: 3600},
				Ns:  h.ns1,
			},
			&dns.NS{
				Hdr: dns.RR_Header{Name: cleanBase, Rrtype: dns.TypeNS, Class: dns.ClassINET, Ttl: 3600},
				Ns:  h.ns2,
			},
		)

	case dns.TypeSOA:
		m.Answer = append(m.Answer, &dns.SOA{
			Hdr:     dns.RR_Header{Name: cleanBase, Rrtype: dns.TypeSOA, Class: dns.ClassINET, Ttl: 3600},
			Ns:      h.soaMName,
			Mbox:    h.soaRName,
			Serial:  uint32(time.Now().Unix()),
			Refresh: 7200,
			Retry:   3600,
			Expire:  1209600,
			Minttl:  300,
		})

	default:
		m.Rcode = dns.RcodeSuccess
	}

	log.Printf("[DNS] Replying to %s: rcode=%s, answers=%d", w.RemoteAddr(), dns.RcodeToString[m.Rcode], len(m.Answer))
	_ = w.WriteMsg(m)
}

func startHTTPServer(addr string, token string, store *AcmeStore) *http.Server {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/acme/challenge", func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			auth := r.Header.Get("Authorization")
			if auth != "Bearer "+token && r.URL.Query().Get("token") != token {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}

		switch r.Method {
		case http.MethodPost:
			var body struct {
				Value string `json:"value"`
				TTL   int    `json:"ttl"` // seconds
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Value) == "" {
				http.Error(w, `{"error":"invalid_payload"}`, http.StatusBadRequest)
				return
			}
			ttlSec := body.TTL
			if ttlSec <= 0 || ttlSec > 86400 {
				ttlSec = 3600 // default 1 hour
			}
			store.Set(strings.TrimSpace(body.Value), time.Duration(ttlSec)*time.Second)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    true,
				"value": body.Value,
				"ttl":   ttlSec,
			})

		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"challenges": store.GetAll(),
			})

		case http.MethodDelete:
			val := r.URL.Query().Get("value")
			if val != "" {
				store.Delete(val)
			} else {
				store.Clear()
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})

		default:
			http.Error(w, `{"error":"method_not_allowed"}`, http.StatusMethodNotAllowed)
		}
	})

	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}
	go func() {
		log.Printf("[HTTP] Management server listening on http://%s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[HTTP] Server error: %v", err)
		}
	}()
	return srv
}

func main() {
	flag.Parse()

	token := *flagToken
	if envToken := os.Getenv("EQT_DNS_TOKEN"); envToken != "" && token == "" {
		token = envToken
	}

	store := newAcmeStore()
	handler := &DNSHandler{
		baseDomain: *flagDomain,
		store:      store,
		ns1:        *flagNS1,
		ns2:        *flagNS2,
		soaMName:   *flagSOAMName,
		soaRName:   *flagSOARName,
	}

	var dnsAddr string
	if *flagListenIP != "" {
		dnsAddr = fmt.Sprintf("%s:%d", *flagListenIP, *flagDNSPort)
	} else {
		dnsAddr = fmt.Sprintf(":%d", *flagDNSPort)
	}

	udpServer := &dns.Server{Addr: dnsAddr, Net: "udp", Handler: handler}
	tcpServer := &dns.Server{Addr: dnsAddr, Net: "tcp", Handler: handler}

	go func() {
		log.Printf("[DNS] UDP server listening on %s (zone: %s)", dnsAddr, *flagDomain)
		if err := udpServer.ListenAndServe(); err != nil {
			log.Fatalf("[DNS] UDP server failed: %v", err)
		}
	}()

	go func() {
		log.Printf("[DNS] TCP server listening on %s (zone: %s)", dnsAddr, *flagDomain)
		if err := tcpServer.ListenAndServe(); err != nil {
			log.Fatalf("[DNS] TCP server failed: %v", err)
		}
	}()

	httpAddr := fmt.Sprintf(":%d", *flagHTTPPort)
	httpSrv := startHTTPServer(httpAddr, token, store)

	log.Printf("[EQT-DNS] System initialized successfully. Base domain: %s", *flagDomain)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("[EQT-DNS] Shutting down...")
	_ = udpServer.Shutdown()
	_ = tcpServer.Shutdown()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	log.Println("[EQT-DNS] Server stopped cleanly.")
}
