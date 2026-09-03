package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/miekg/dns"
)

func TestParseIP(t *testing.T) {
	cases := []struct {
		domain   string
		expected string
	}{
		{"192-168-0-201.direct.eqt.net.im.", "192.168.0.201"},
		{"10-0-0-5.direct.eqt.net.im.", "10.0.0.5"},
		{"172-16-1-88.direct.eqt.net.im.", "172.16.1.88"},
		{"192-168-1-50.direct.eqt.net.im.", "192.168.1.50"},
		{"192.168.0.201.direct.eqt.net.im.", "192.168.0.201"},
		{"invalid-ip.direct.eqt.net.im.", ""},
		{"300-1-1-1.direct.eqt.net.im.", ""},
		{"direct.eqt.net.im.", ""},
	}

	for _, tc := range cases {
		ip := parseIP(tc.domain)
		if tc.expected == "" {
			if ip != nil {
				t.Errorf("Expected nil for %s, got %v", tc.domain, ip)
			}
		} else {
			if ip == nil || ip.String() != tc.expected {
				t.Errorf("For %s expected %s, got %v", tc.domain, tc.expected, ip)
			}
		}
	}
}

func TestAcmeStore(t *testing.T) {
	s := newAcmeStore()
	rec := "_acme-challenge.direct.eqt.net.im."
	s.Set(rec, "challenge-1", 100*time.Millisecond)
	s.Set(rec, "challenge-2", 2*time.Second)

	res := s.Get(rec)
	if len(res) != 2 {
		t.Fatalf("Expected 2 challenges, got %d", len(res))
	}

	time.Sleep(150 * time.Millisecond)
	resAfter := s.Get(rec)
	if len(resAfter) != 1 || resAfter[0] != "challenge-2" {
		t.Fatalf("Expected only challenge-2 after expiry, got %v", resAfter)
	}

	s.Delete(rec, "challenge-2")
	if len(s.Get(rec)) != 0 {
		t.Fatalf("Expected 0 challenges after delete")
	}
}

type dummyResponseWriter struct {
	msg *dns.Msg
}

func (d *dummyResponseWriter) LocalAddr() net.Addr       { return &net.UDPAddr{} }
func (d *dummyResponseWriter) RemoteAddr() net.Addr      { return &net.UDPAddr{} }
func (d *dummyResponseWriter) WriteMsg(m *dns.Msg) error { d.msg = m; return nil }
func (d *dummyResponseWriter) Write([]byte) (int, error) { return 0, nil }
func (d *dummyResponseWriter) Close() error              { return nil }
func (d *dummyResponseWriter) TsigStatus() error         { return nil }
func (d *dummyResponseWriter) TsigTimersOnly(bool)       {}
func (d *dummyResponseWriter) Hijack()                   {}

func TestDNSHandler(t *testing.T) {
	store := newAcmeStore()
	rec := "_acme-challenge.direct.eqt.net.im."
	store.Set(rec, "test-token-123", 10*time.Second)

	handler := &DNSHandler{
		baseDomain: "direct.eqt.net.im",
		store:      store,
		ns1:        "ns1.eqt.net.im.",
		ns2:        "ns2.eqt.net.im.",
		soaMName:   "ns1.eqt.net.im.",
		soaRName:   "admin.eqt.net.im.",
	}

	// 1. Query A record
	reqA := new(dns.Msg)
	reqA.SetQuestion("192-168-0-201.direct.eqt.net.im.", dns.TypeA)
	rwA := &dummyResponseWriter{}
	handler.ServeDNS(rwA, reqA)

	if len(rwA.msg.Answer) != 1 {
		t.Fatalf("Expected 1 answer for A query, got %d", len(rwA.msg.Answer))
	}
	aRecord, ok := rwA.msg.Answer[0].(*dns.A)
	if !ok || aRecord.A.String() != "192.168.0.201" {
		t.Fatalf("Expected 192.168.0.201, got %v", aRecord.A)
	}

	// 2. Query ACME TXT record (exact match)
	reqTXT := new(dns.Msg)
	reqTXT.SetQuestion("_acme-challenge.direct.eqt.net.im.", dns.TypeTXT)
	rwTXT := &dummyResponseWriter{}
	handler.ServeDNS(rwTXT, reqTXT)

	if len(rwTXT.msg.Answer) != 1 {
		t.Fatalf("Expected 1 answer for TXT query, got %d", len(rwTXT.msg.Answer))
	}
	txtRecord, ok := rwTXT.msg.Answer[0].(*dns.TXT)
	if !ok || len(txtRecord.Txt) != 1 || txtRecord.Txt[0] != "test-token-123" {
		t.Fatalf("Expected test-token-123, got %v", txtRecord.Txt)
	}

	// 3. Query Out-of-zone
	reqOut := new(dns.Msg)
	reqOut.SetQuestion("example.com.", dns.TypeA)
	rwOut := &dummyResponseWriter{}
	handler.ServeDNS(rwOut, reqOut)
	if rwOut.msg.Rcode != dns.RcodeRefused {
		t.Fatalf("Expected Refused for out-of-zone, got %d", rwOut.msg.Rcode)
	}
}

func TestHTTPManagement(t *testing.T) {
	store := newAcmeStore()
	srv := startHTTPServer("127.0.0.1:0", "secret-token", "direct.eqt.net.im", store)
	defer srv.Close()

	// 1. Health check
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
	rw := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rw, req)
	if rw.Code != http.StatusOK {
		t.Fatalf("Expected 200 for /health, got %d", rw.Code)
	}

	// 2. Post ACME challenge without auth (should fail 401)
	body, _ := json.Marshal(map[string]interface{}{"value": "token-xyz"})
	reqPostNoAuth, _ := http.NewRequest(http.MethodPost, "/acme/challenge", bytes.NewReader(body))
	rwPostNoAuth := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rwPostNoAuth, reqPostNoAuth)
	if rwPostNoAuth.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 without auth, got %d", rwPostNoAuth.Code)
	}

	// 3. Post ACME challenge with invalid chars (should fail 400)
	bodyInvalid, _ := json.Marshal(map[string]interface{}{"value": "invalid token with spaces; rm -rf"})
	reqPostInvalid, _ := http.NewRequest(http.MethodPost, "/acme/challenge", bytes.NewReader(bodyInvalid))
	reqPostInvalid.Header.Set("Authorization", "Bearer secret-token")
	rwPostInvalid := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rwPostInvalid, reqPostInvalid)
	if rwPostInvalid.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 for invalid token value, got %d", rwPostInvalid.Code)
	}

	// 4. Post ACME challenge with valid auth
	reqPost, _ := http.NewRequest(http.MethodPost, "/acme/challenge", bytes.NewReader(body))
	reqPost.Header.Set("Authorization", "Bearer secret-token")
	rwPost := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rwPost, reqPost)
	if rwPost.Code != http.StatusOK {
		t.Fatalf("Expected 200 for post challenge, got %d", rwPost.Code)
	}

	rec := "_acme-challenge.direct.eqt.net.im."
	if len(store.Get(rec)) != 1 || store.Get(rec)[0] != "token-xyz" {
		t.Fatalf("Expected token-xyz in store, got %v", store.Get(rec))
	}

	// 5. Post ACME challenge to illegitimate zone (should fail 400)
	bodyBadZone, _ := json.Marshal(map[string]interface{}{"record": "_acme-challenge.evil.com.", "value": "token-evil"})
	reqPostBadZone, _ := http.NewRequest(http.MethodPost, "/acme/challenge", bytes.NewReader(bodyBadZone))
	reqPostBadZone.Header.Set("Authorization", "Bearer secret-token")
	rwPostBadZone := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rwPostBadZone, reqPostBadZone)
	if rwPostBadZone.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 for bad zone record, got %d", rwPostBadZone.Code)
	}

	// 6. Delete single record
	reqDelRecord, _ := http.NewRequest(http.MethodDelete, "/acme/challenge?record="+rec, nil)
	reqDelRecord.Header.Set("Authorization", "Bearer secret-token")
	rwDelRecord := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rwDelRecord, reqDelRecord)
	if rwDelRecord.Code != http.StatusOK {
		t.Fatalf("Expected 200 for delete record, got %d", rwDelRecord.Code)
	}
	if len(store.Get(rec)) != 0 {
		t.Fatalf("Expected 0 challenges after deleting record")
	}
}

func TestTXTNODATAResponse(t *testing.T) {
	store := newAcmeStore()
	handler := &DNSHandler{
		baseDomain: "direct.eqt.net.im",
		store:      store,
		ns1:        "ns1.eqt.net.im.",
		ns2:        "ns2.eqt.net.im.",
		soaMName:   "ns1.eqt.net.im.",
		soaRName:   "admin.eqt.net.im.",
	}

	// 1. Query TXT on existing A record hostname (should return NOERROR with 0 answers)
	req := new(dns.Msg)
	req.SetQuestion("192-168-0-201.direct.eqt.net.im.", dns.TypeTXT)
	rw := &dummyResponseWriter{}
	handler.ServeDNS(rw, req)
	if rw.msg.Rcode != dns.RcodeSuccess {
		t.Fatalf("Expected NOERROR for existing name TXT query, got %d", rw.msg.Rcode)
	}
	if len(rw.msg.Answer) != 0 {
		t.Fatalf("Expected 0 answers (NODATA), got %d", len(rw.msg.Answer))
	}

	// 2. Query TXT on completely non-existent name (should return NXDOMAIN)
	reqNonExist := new(dns.Msg)
	reqNonExist.SetQuestion("random-non-existent.direct.eqt.net.im.", dns.TypeTXT)
	rwNonExist := &dummyResponseWriter{}
	handler.ServeDNS(rwNonExist, reqNonExist)
	if rwNonExist.msg.Rcode != dns.RcodeNameError {
		t.Fatalf("Expected NXDOMAIN for non-existent name TXT query, got %d", rwNonExist.msg.Rcode)
	}
}
