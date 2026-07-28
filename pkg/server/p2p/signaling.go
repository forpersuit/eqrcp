package p2p

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

const DefaultSignalingURL = "https://signal.eqt.net.im"

// SignalingClient handles HTTP communication with the Cloudflare Worker signaling server.
type SignalingClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

// NewSignalingClient creates a new client targeting the specified or default signaling server URL.
func NewSignalingClient(baseURL string) *SignalingClient {
	if baseURL == "" {
		if envURL := os.Getenv("EQT_SIGNAL_SERVER"); envURL != "" {
			baseURL = envURL
		} else {
			baseURL = DefaultSignalingURL
		}
	}
	return &SignalingClient{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

type CreateRoomResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
	Data    struct {
		RoomID      string   `json:"room_id"`
		HostToken   string   `json:"host_token"`
		ClientToken string   `json:"client_token"`
		ExpiresAt   int64    `json:"expires_at"`
		STUNServers []string `json:"stun_servers"`
	} `json:"data"`
}

type JoinRoomResponse struct {
	Code  int    `json:"code"`
	Error string `json:"error,omitempty"`
	Data  struct {
		RoomID      string   `json:"room_id"`
		ClientToken string   `json:"client_token"`
		STUNServers []string `json:"stun_servers"`
	} `json:"data"`
}

type SignalItem struct {
	ID        int    `json:"id"`
	Sender    string `json:"sender"`
	Type      string `json:"type"`
	Payload   string `json:"payload"`
	CreatedAt int64  `json:"created_at"`
}

type PollSignalsResponse struct {
	Code int `json:"code"`
	Data struct {
		RoomID  string       `json:"room_id"`
		Role    string       `json:"role"`
		Signals []SignalItem `json:"signals"`
	} `json:"data"`
}

func (c *SignalingClient) executeRequest(reqFactory func(baseURL string) (*http.Request, error)) (*http.Response, string, error) {
	ep := c.BaseURL
	req, err := reqFactory(ep)
	if err != nil {
		return nil, ep, fmt.Errorf("failed to create request for %s: %w", ep, err)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, ep, fmt.Errorf("signaling request to %s failed: %w", ep, err)
	}
	return resp, ep, nil
}

// CreateRoom requests a new P2P room with Pro tier verification.
func (c *SignalingClient) CreateRoom(licenseCode, deviceID string) (*CreateRoomResponse, error) {
	return c.CreateRoomWithMode(licenseCode, deviceID, "share")
}

// CreateRoomWithMode requests a new P2P room with specified mode and Pro tier verification.
func (c *SignalingClient) CreateRoomWithMode(licenseCode, deviceID, mode string) (*CreateRoomResponse, error) {
	if mode == "" {
		mode = "share"
	}
	resp, usedEP, err := c.executeRequest(func(baseURL string) (*http.Request, error) {
		reqURL := fmt.Sprintf("%s/api/v1/p2p/room/create", baseURL)
		payloadObj := map[string]string{"mode": mode}
		payloadBytes, _ := json.Marshal(payloadObj)
		req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewBuffer(payloadBytes))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if licenseCode != "" {
			req.Header.Set("X-License-Code", licenseCode)
		}
		if deviceID != "" {
			req.Header.Set("X-Device-ID", deviceID)
		}
		return req, nil
	})
	if err != nil {
		return nil, fmt.Errorf("signaling request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read signaling response from %s: %w", usedEP, err)
	}

	var result CreateRoomResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse signaling response from %s: %w, body: %s", usedEP, err, string(body))
	}

	if resp.StatusCode != http.StatusOK || result.Code != 200 {
		errStr := result.Error
		if errStr == "" {
			errStr = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		msgStr := result.Message
		if msgStr == "" {
			msgStr = string(body)
		}
		return &result, fmt.Errorf("signaling server (%s) returned error (%d): %s - %s", usedEP, resp.StatusCode, errStr, msgStr)
	}

	return &result, nil
}

// JoinRoom registers a remote client into an existing room.
func (c *SignalingClient) JoinRoom(roomID string) (*JoinRoomResponse, error) {
	resp, _, err := c.executeRequest(func(baseURL string) (*http.Request, error) {
		reqURL := fmt.Sprintf("%s/api/v1/p2p/room/join", baseURL)
		payloadObj := map[string]string{"room_id": roomID}
		payloadBytes, _ := json.Marshal(payloadObj)

		req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewBuffer(payloadBytes))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		return req, nil
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result JoinRoomResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse join response: %w", err)
	}

	if resp.StatusCode != http.StatusOK || result.Code != 200 {
		return &result, fmt.Errorf("join room error (%d): %s", resp.StatusCode, result.Error)
	}

	return &result, nil
}

// PushSignal sends an SDP Offer/Answer or ICE Candidate to the room.
func (c *SignalingClient) PushSignal(roomID, token, signalType, payload string) error {
	resp, _, err := c.executeRequest(func(baseURL string) (*http.Request, error) {
		reqURL := fmt.Sprintf("%s/api/v1/p2p/signal/push", baseURL)
		payloadObj := map[string]string{
			"room_id": roomID,
			"type":    signalType,
			"payload": payload,
		}
		payloadBytes, _ := json.Marshal(payloadObj)

		req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewBuffer(payloadBytes))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Room-Token", token)
		return req, nil
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("push signal failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// PollSignals fetches pending signals from the remote peer.
func (c *SignalingClient) PollSignals(roomID, token string, since int) ([]SignalItem, error) {
	resp, _, err := c.executeRequest(func(baseURL string) (*http.Request, error) {
		reqURL := fmt.Sprintf("%s/api/v1/p2p/signal/poll?room_id=%s&since=%s",
			baseURL, url.QueryEscape(roomID), strconv.Itoa(since))

		req, err := http.NewRequest(http.MethodGet, reqURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("X-Room-Token", token)
		return req, nil
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result PollSignalsResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse poll signals: %w", err)
	}

	if resp.StatusCode != http.StatusOK || result.Code != 200 {
		return nil, fmt.Errorf("poll signals error (%d)", resp.StatusCode)
	}

	return result.Data.Signals, nil
}

// DestroyRoom deletes the room on the signaling server.
func (c *SignalingClient) DestroyRoom(roomID, token string) error {
	resp, _, err := c.executeRequest(func(baseURL string) (*http.Request, error) {
		reqURL := fmt.Sprintf("%s/api/v1/p2p/room?room_id=%s", baseURL, url.QueryEscape(roomID))
		req, err := http.NewRequest(http.MethodDelete, reqURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("X-Room-Token", token)
		return req, nil
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}
