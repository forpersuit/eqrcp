package server

import (
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"eqt/pkg/qr"
)

func TestQRThreeModesLANAndWAN(t *testing.T) {
	modes := []struct {
		name   string
		lanURL string
		wanURL string
	}{
		{
			name:   "Share Mode",
			lanURL: "http://192.168.1.100:9090/s1234567/",
			wanURL: "https://eqt.net.im/p/share?token=s1234567",
		},
		{
			name:   "Receive Mode",
			lanURL: "http://192.168.1.100:9090/r9876543/",
			wanURL: "https://eqt.net.im/p/receive?token=r9876543",
		},
		{
			name:   "Chat Mode",
			lanURL: "http://192.168.1.100:9090/chat-v2/sess_abc?join=join_xyz",
			wanURL: "https://eqt.net.im/p/chat?token=sess_abc&join=join_xyz",
		},
	}

	for _, tc := range modes {
		t.Run(tc.name+"_LAN", func(t *testing.T) {
			img, err := qr.RenderImage(tc.lanURL)
			if err != nil {
				t.Fatalf("Failed to render LAN QR for %s: %v", tc.name, err)
			}
			if img == nil {
				t.Fatalf("Rendered LAN QR image is nil for %s", tc.name)
			}
			bounds := img.Bounds()
			if bounds.Dx() != 256 || bounds.Dy() != 256 {
				t.Errorf("Expected 256x256 image, got %dx%d for %s", bounds.Dx(), bounds.Dy(), tc.name)
			}
		})

		t.Run(tc.name+"_WAN", func(t *testing.T) {
			img, err := qr.RenderImage(tc.wanURL)
			if err != nil {
				t.Fatalf("Failed to render WAN QR for %s: %v", tc.name, err)
			}
			if img == nil {
				t.Fatalf("Rendered WAN QR image is nil for %s", tc.name)
			}
			bounds := img.Bounds()
			if bounds.Dx() != 256 || bounds.Dy() != 256 {
				t.Errorf("Expected 256x256 image, got %dx%d for %s", bounds.Dx(), bounds.Dy(), tc.name)
			}
		})
	}
}

func TestServeQRHandlerDynamicText(t *testing.T) {
	s := &Server{
		mux: http.NewServeMux(),
	}
	_ = s.ServeQR("http://127.0.0.1:9090/default/")

	testCases := []string{
		"http://192.168.1.100:9090/share/token123",
		"https://eqt.net.im/p/share?token=token123",
		"https://eqt.net.im/p/receive?token=rec456",
		"https://eqt.net.im/p/chat?token=chat789&join=join111",
	}

	for _, targetURL := range testCases {
		req := httptest.NewRequest("GET", "/qr/image?text="+targetURL, nil)
		w := httptest.NewRecorder()
		s.mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected status 200 OK for %s, got %d", targetURL, w.Code)
		}
		if contentType := w.Header().Get("Content-Type"); contentType != "image/png" {
			t.Errorf("Expected Content-Type image/png, got %s", contentType)
		}

		img, err := png.Decode(w.Body)
		if err != nil {
			t.Errorf("Failed to decode PNG body for %s: %v", targetURL, err)
		}
		if img == nil || img.Bounds().Dx() != 256 {
			t.Errorf("Invalid decoded PNG dimensions for %s", targetURL)
		}
	}
}
