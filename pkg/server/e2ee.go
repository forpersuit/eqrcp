package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"eqt/pkg/crypto/e2ee"
)

// E2EEChunkPlaintextSize is the default plaintext chunk size (4MB).
const E2EEChunkPlaintextSize = 4 * 1024 * 1024

// E2EEMaxChunkEnvelopeSize is 4MB + 28B header + 16B tag + buffer margin.
const E2EEMaxChunkEnvelopeSize = E2EEChunkPlaintextSize + 28 + 16 + 1024

// chunkPool4MB implements sync.Pool for zero-allocation 4MB buffers across concurrent chunks.
var chunkPool4MB = sync.Pool{
	New: func() any {
		b := make([]byte, E2EEChunkPlaintextSize)
		return &b
	},
}

// e2eeReceiveFile tracks the assembly and concurrent write of an incoming encrypted file.
type e2eeReceiveFile struct {
	mu             sync.Mutex
	FileID         string
	FileName       string
	TargetDir      string
	TempPath       string
	FinalPath      string
	TotalBytes     int64
	TotalChunks    uint32
	ReceivedChunks map[uint32]bool
	File           *os.File
	ClientID       string
	Completed      bool
	Cancelled      bool
	CreatedAt      time.Time
	ActiveWriters  int
}

// EnableE2EE enables E2EE on the server with the given 32-byte MasterKey and sessionID.
func (s *Server) EnableE2EE(masterKey []byte, sessionID string) error {
	keys, err := e2ee.DeriveKeys(masterKey)
	if err != nil {
		return fmt.Errorf("server: failed to derive E2EE keys: %w", err)
	}

	s.e2eeReceiveFilesMu.Lock()
	defer s.e2eeReceiveFilesMu.Unlock()

	s.e2eeActive = true
	s.e2eeMasterKey = append([]byte(nil), masterKey...)
	s.e2eeKeys = keys
	s.e2eeSessionID = sessionID
	return nil
}

// IsE2EEActive reports whether E2EE mode is enabled on the server.
func (s *Server) IsE2EEActive() bool {
	s.e2eeReceiveFilesMu.RLock()
	defer s.e2eeReceiveFilesMu.RUnlock()
	return s.e2eeActive
}

// GetE2EEDerivedKeys returns the active E2EE derived keys.
func (s *Server) GetE2EEDerivedKeys() *e2ee.DerivedKeys {
	s.e2eeReceiveFilesMu.RLock()
	defer s.e2eeReceiveFilesMu.RUnlock()
	return s.e2eeKeys
}

// BanClient silences and bans a client instance, immediately purging active temp files.
func (s *Server) BanClient(clientID string) {
	if clientID == "" {
		return
	}
	s.sessionBannedMu.Lock()
	if s.sessionBannedClients == nil {
		s.sessionBannedClients = make(map[string]bool)
	}
	s.sessionBannedClients[clientID] = true
	s.sessionBannedMu.Unlock()

	// Red Line §7.5: Immediately delete in-flight temporary files for banned client
	s.e2eeReceiveFilesMu.Lock()
	var toPurge []*e2eeReceiveFile
	for fileID, rf := range s.e2eeReceiveFiles {
		if rf.ClientID == clientID {
			toPurge = append(toPurge, rf)
			delete(s.e2eeReceiveFiles, fileID)
		}
	}
	s.e2eeReceiveFilesMu.Unlock()

	for _, rf := range toPurge {
		rf.mu.Lock()
		rf.Cancelled = true
		if rf.File != nil {
			_ = rf.File.Close()
			rf.File = nil
		}
		if rf.TempPath != "" {
			_ = os.Remove(rf.TempPath)
		}
		rf.mu.Unlock()
	}
}

// UnbanClient removes the ban on a client instance.
func (s *Server) UnbanClient(clientID string) {
	if clientID == "" {
		return
	}
	s.sessionBannedMu.Lock()
	defer s.sessionBannedMu.Unlock()
	if s.sessionBannedClients != nil {
		delete(s.sessionBannedClients, clientID)
	}
}

// IsClientBanned checks if a client instance is banned.
func (s *Server) IsClientBanned(clientID string) bool {
	if clientID == "" {
		return false
	}
	s.sessionBannedMu.RLock()
	defer s.sessionBannedMu.RUnlock()
	return s.sessionBannedClients != nil && s.sessionBannedClients[clientID]
}

// handleE2EEReceiveChunk processes a single 4MB encrypted chunk upload (POST /receive/{path}/chunk).
func (s *Server) handleE2EEReceiveChunk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := s.getClientID(r, w)
	if s.IsClientBanned(clientID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":         false,
			"error_code": "CLIENT_BANNED",
			"error":      "Device transfer has been blocked by host.",
		})
		return
	}

	// Extract headers / query parameters
	fileID := r.Header.Get("X-File-ID")
	if fileID == "" {
		fileID = r.URL.Query().Get("file_id")
	}
	chunkIndexStr := r.Header.Get("X-Chunk-Index")
	if chunkIndexStr == "" {
		chunkIndexStr = r.URL.Query().Get("chunk_index")
	}
	totalChunksStr := r.Header.Get("X-Total-Chunks")
	if totalChunksStr == "" {
		totalChunksStr = r.URL.Query().Get("total_chunks")
	}
	totalBytesStr := r.Header.Get("X-Total-Bytes")
	if totalBytesStr == "" {
		totalBytesStr = r.URL.Query().Get("total_bytes")
	}
	fileName := r.Header.Get("X-File-Name")
	if fileName == "" {
		fileName = r.URL.Query().Get("file_name")
	}
	if unescaped, err := url.QueryUnescape(fileName); err == nil && unescaped != "" {
		fileName = unescaped
	}
	if b64Dec, err := base64.StdEncoding.DecodeString(fileName); err == nil && len(b64Dec) > 0 {
		fileName = string(b64Dec)
	}

	if fileID == "" || chunkIndexStr == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "INVALID_PARAMS", "error": "Missing file_id or chunk_index"})
		return
	}

	chunkIndex64, err := strconv.ParseUint(chunkIndexStr, 10, 32)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "INVALID_CHUNK_INDEX", "error": "Invalid chunk_index"})
		return
	}
	chunkIndex := uint32(chunkIndex64)

	totalChunks64, _ := strconv.ParseUint(totalChunksStr, 10, 32)
	totalChunks := uint32(totalChunks64)
	if totalChunks == 0 {
		totalChunks = chunkIndex + 1
	}

	totalBytes, _ := strconv.ParseInt(totalBytesStr, 10, 64)

	// Read ciphertext body up to 5MB max
	envelopeBytes, err := io.ReadAll(io.LimitReader(r.Body, E2EEMaxChunkEnvelopeSize))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "READ_FAILED", "error": err.Error()})
		return
	}

	keys := s.GetE2EEDerivedKeys()
	if keys == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "E2EE_UNINITIALIZED", "error": "Server E2EE keys not initialized"})
		return
	}

	// Decrypt and verify AEAD tag
	plaintext, err := e2ee.DecryptChunk(envelopeBytes, chunkIndex, keys.RecvKey[:], fileID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":         false,
			"error_code": "AUTH_FAILED",
			"error":      err.Error(),
		})
		return
	}
	defer e2ee.Zeroize(plaintext)

	// Obtain or initialize the e2eeReceiveFile entry
	s.e2eeReceiveFilesMu.Lock()
	if s.e2eeReceiveFiles == nil {
		s.e2eeReceiveFiles = make(map[string]*e2eeReceiveFile)
	}

	// Purge stale entries (>30m)
	now := time.Now()
	var toCleanStale []*e2eeReceiveFile
	for k, v := range s.e2eeReceiveFiles {
		if now.Sub(v.CreatedAt) > 30*time.Minute {
			toCleanStale = append(toCleanStale, v)
			delete(s.e2eeReceiveFiles, k)
		}
	}
	s.e2eeReceiveFilesMu.Unlock()

	// Safely close and purge temp files outside map lock
	for _, staleRf := range toCleanStale {
		staleRf.mu.Lock()
		if staleRf.File != nil {
			_ = staleRf.File.Close()
			staleRf.File = nil
		}
		if !staleRf.Completed && staleRf.TempPath != "" {
			_ = os.Remove(staleRf.TempPath)
		}
		staleRf.Cancelled = true
		staleRf.mu.Unlock()
	}

	s.e2eeReceiveFilesMu.Lock()
	rf, exists := s.e2eeReceiveFiles[fileID]
	if exists && (rf.Completed || rf.Cancelled) {
		if chunkIndex == 0 {
			// New transfer restarting with same fileID
			if rf.File != nil {
				_ = rf.File.Close()
			}
			delete(s.e2eeReceiveFiles, fileID)
			exists = false
		} else if rf.Completed {
			// Idempotent 200 OK for already-completed file
			s.e2eeReceiveFilesMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":          true,
				"file_id":     fileID,
				"chunk_index": chunkIndex,
				"completed":   true,
			})
			return
		}
	}

	if !exists {
		cleanName := filepath.Base(fileName)
		if cleanName == "" || cleanName == "." {
			cleanName = fmt.Sprintf("received_%s.dat", fileID)
		}

		targetDir := s.outputDir
		if targetDir == "" {
			targetDir = "."
		}

		// Device directory segregation
		fullTargetDir, dirErr := s.getDeviceOutputDir(clientID)
		if dirErr != nil || fullTargetDir == "" {
			fullTargetDir = targetDir
		}
		_ = os.MkdirAll(fullTargetDir, 0755)

		tempPath := filepath.Join(fullTargetDir, cleanName+".tmp")
		finalPath := filepath.Join(fullTargetDir, cleanName)

		file, openErr := os.OpenFile(tempPath, os.O_CREATE|os.O_RDWR, 0644)
		if openErr != nil {
			s.e2eeReceiveFilesMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "FILE_CREATE_FAILED", "error": openErr.Error()})
			return
		}

		rf = &e2eeReceiveFile{
			FileID:         fileID,
			FileName:       cleanName,
			TargetDir:      fullTargetDir,
			TempPath:       tempPath,
			FinalPath:      finalPath,
			TotalBytes:     totalBytes,
			TotalChunks:    totalChunks,
			ReceivedChunks: make(map[uint32]bool),
			File:           file,
			ClientID:       clientID,
			CreatedAt:      time.Now(),
		}
		s.e2eeReceiveFiles[fileID] = rf
	}
	s.e2eeReceiveFilesMu.Unlock()

	// Check if file was cancelled in the meantime
	rf.mu.Lock()
	if rf.Cancelled || rf.File == nil {
		rf.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "CLIENT_BANNED", "error": "Transfer cancelled or banned."})
		return
	}

	// Write block at deterministic physical offset without global lock
	offset := int64(chunkIndex) * int64(E2EEChunkPlaintextSize)
	_, writeErr := rf.File.WriteAt(plaintext, offset)
	if writeErr != nil {
		rf.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "WRITE_FAILED", "error": writeErr.Error()})
		return
	}

	rf.ReceivedChunks[chunkIndex] = true
	isComplete := len(rf.ReceivedChunks) >= int(rf.TotalChunks)

	if isComplete && !rf.Completed {
		if rf.TotalBytes > 0 {
			_ = rf.File.Truncate(rf.TotalBytes)
		}
		_ = rf.File.Sync()
		_ = rf.File.Close()
		rf.File = nil

		// Resolve duplicate filename collisions if target exists
		resolvedFinalPath := s.resolveFilenameCollision(rf.FinalPath)
		_ = os.Rename(rf.TempPath, resolvedFinalPath)
		rf.FinalPath = resolvedFinalPath
		rf.Completed = true

		s.recordCompletedE2EEFile(rf)
	}
	rf.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"file_id":     fileID,
		"chunk_index": chunkIndex,
		"completed":   isComplete,
	})
}

// handleE2EEReceiveChunkStatus returns the continuous index M and received ranges (GET /receive/{path}/chunk_status).
func (s *Server) handleE2EEReceiveChunkStatus(w http.ResponseWriter, r *http.Request) {
	fileID := r.URL.Query().Get("file_id")
	clientID := s.getClientID(r, w)

	if s.IsClientBanned(clientID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":               true,
			"banned":           true,
			"continuous_index": 0,
			"received_ranges":  [][]uint32{},
		})
		return
	}

	s.e2eeReceiveFilesMu.RLock()
	rf, exists := s.e2eeReceiveFiles[fileID]
	s.e2eeReceiveFilesMu.RUnlock()

	if !exists || rf == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":               true,
			"file_id":          fileID,
			"continuous_index": 0,
			"received_ranges":  [][]uint32{},
			"completed":        false,
		})
		return
	}

	rf.mu.Lock()
	continuousIndex, ranges := computeContinuousRanges(rf.ReceivedChunks)
	completed := rf.Completed
	rf.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":               true,
		"file_id":          fileID,
		"continuous_index": continuousIndex,
		"received_ranges":  ranges,
		"completed":        completed,
	})
}

// computeContinuousRanges calculates the continuous chunk index M from chunk 0 and all contiguous intervals.
func computeContinuousRanges(received map[uint32]bool) (uint32, [][]uint32) {
	if len(received) == 0 {
		return 0, [][]uint32{}
	}

	var m uint32
	for received[m] {
		m++
	}

	// Build intervals
	var ranges [][]uint32
	var inRange bool
	var start uint32

	maxChunk := uint32(0)
	for idx := range received {
		if idx > maxChunk {
			maxChunk = idx
		}
	}

	for i := uint32(0); i <= maxChunk+1; i++ {
		if received[i] {
			if !inRange {
				start = i
				inRange = true
			}
		} else {
			if inRange {
				ranges = append(ranges, []uint32{start, i - 1})
				inRange = false
			}
		}
	}

	return m, ranges
}

// resolveFilenameCollision resolves duplicate target file collisions.
func (s *Server) resolveFilenameCollision(targetPath string) string {
	if _, err := os.Stat(targetPath); os.IsNotExist(err) {
		return targetPath
	}

	dir := filepath.Dir(targetPath)
	ext := filepath.Ext(targetPath)
	name := strings.TrimSuffix(filepath.Base(targetPath), ext)

	for i := 1; i < 10000; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", name, i, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return targetPath
}

// recordCompletedE2EEFile updates server transfer stats on successful E2EE file completion.
func (s *Server) recordCompletedE2EEFile(rf *e2eeReceiveFile) {
	s.statusMu.Lock()
	s.status.SavedFiles = append(s.status.SavedFiles, rf.FinalPath)
	fileCount := len(s.status.SavedFiles)
	if fileCount == 1 {
		s.status.Message = "Received 1 file."
	} else {
		s.status.Message = fmt.Sprintf("Received %d files.", fileCount)
	}
	s.statusSeq++
	s.statusMu.Unlock()

	s.clientStatesMu.Lock()
	if s.clientStates == nil {
		s.clientStates = make(map[string]*ClientTransferStateInfo)
	}
	cs, exists := s.clientStates[rf.ClientID]
	if !exists || cs == nil {
		cs = &ClientTransferStateInfo{
			ClientID:   rf.ClientID,
			SavedFiles: []string{},
		}
		s.clientStates[rf.ClientID] = cs
	}
	cs.SavedFiles = append(cs.SavedFiles, rf.FinalPath)
	cs.Percent = 100
	cs.Current = "Transfer Complete"
	s.clientStatesMu.Unlock()

	s.recordStatus()
}

// handleDeviceBan handles POST /api/device/ban
func (s *Server) handleDeviceBan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ClientID string `json:"client_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ClientID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Invalid client_id"})
		return
	}

	s.BanClient(req.ClientID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "banned": true, "client_id": req.ClientID})
}

// handleDeviceUnban handles POST /api/device/unban
func (s *Server) handleDeviceUnban(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ClientID string `json:"client_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ClientID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Invalid client_id"})
		return
	}

	s.UnbanClient(req.ClientID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "banned": false, "client_id": req.ClientID})
}

// E2EEShareFileInfo describes a shared file metadata in E2EE mode.
type E2EEShareFileInfo struct {
	FileID      string `json:"file_id"`
	FileName    string `json:"file_name"`
	FileSize    int64  `json:"file_size"`
	TotalChunks uint32 `json:"total_chunks"`
	ChunkSize   int    `json:"chunk_size"`
}

// handleE2EEShareMeta returns metadata for the shared files in E2EE mode.
func (s *Server) handleE2EEShareMeta(w http.ResponseWriter, r *http.Request) {
	clientID := s.getClientID(r, w)
	if s.IsClientBanned(clientID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "CLIENT_BANNED"})
		return
	}

	var files []E2EEShareFileInfo
	if s.body.Archive || (s.body.Path != "" && len(s.body.Paths) == 0) {
		// Archive mode (single virtual or real ZIP archive)
		archiveName := s.body.Filename
		if archiveName == "" {
			archiveName = "archive.zip"
		}
		var size int64
		if fi, err := os.Stat(s.body.Path); err == nil {
			size = fi.Size()
		}
		totalChunks := uint32((size + E2EEChunkPlaintextSize - 1) / E2EEChunkPlaintextSize)
		if totalChunks == 0 {
			totalChunks = 1
		}
		files = append(files, E2EEShareFileInfo{
			FileID:      "f-0",
			FileName:    archiveName,
			FileSize:    size,
			TotalChunks: totalChunks,
			ChunkSize:   E2EEChunkPlaintextSize,
		})
	} else {
		for idx, p := range s.body.Paths {
			fi, err := os.Stat(p)
			if err != nil {
				continue
			}
			var size int64
			if fi.IsDir() {
				// Directories are handled via archive path if zipped
				if s.body.Path != "" {
					if afi, aErr := os.Stat(s.body.Path); aErr == nil {
						size = afi.Size()
					}
				}
			} else {
				size = fi.Size()
			}

			totalChunks := uint32((size + E2EEChunkPlaintextSize - 1) / E2EEChunkPlaintextSize)
			if totalChunks == 0 {
				totalChunks = 1
			}

			files = append(files, E2EEShareFileInfo{
				FileID:      fmt.Sprintf("f-%d", idx),
				FileName:    filepath.Base(p),
				FileSize:    size,
				TotalChunks: totalChunks,
				ChunkSize:   E2EEChunkPlaintextSize,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"session_id": s.e2eeSessionID,
		"is_e2ee":    s.IsE2EEActive(),
		"files":      files,
	})
}

// handleE2EEShareChunk serves an encrypted 4MB chunk of a shared file.
func (s *Server) handleE2EEShareChunk(w http.ResponseWriter, r *http.Request) {
	clientID := s.getClientID(r, w)
	if s.IsClientBanned(clientID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "CLIENT_BANNED"})
		return
	}

	keys := s.GetE2EEDerivedKeys()
	if keys == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "E2EE_UNINITIALIZED"})
		return
	}

	fileID := r.URL.Query().Get("file_id")
	if fileID == "" {
		fileID = "f-0"
	}

	var filePath string
	if s.body.Archive || (s.body.Path != "" && len(s.body.Paths) == 0) {
		filePath = s.body.Path
	} else {
		var fileIndex int
		fmt.Sscanf(fileID, "f-%d", &fileIndex)
		if fileIndex < 0 || fileIndex >= len(s.body.Paths) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "FILE_NOT_FOUND"})
			return
		}
		p := s.body.Paths[fileIndex]
		if fi, err := os.Stat(p); err == nil && fi.IsDir() && s.body.Path != "" {
			filePath = s.body.Path
		} else {
			filePath = p
		}
	}

	chunkIndexStr := r.URL.Query().Get("chunk_index")
	chunkIndex64, err := strconv.ParseUint(chunkIndexStr, 10, 32)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "INVALID_CHUNK_INDEX"})
		return
	}
	chunkIndex := uint32(chunkIndex64)

	f, err := os.Open(filePath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "FILE_READ_FAILED", "error": err.Error()})
		return
	}
	defer f.Close()

	offset := int64(chunkIndex) * int64(E2EEChunkPlaintextSize)
	bufPtr := chunkPool4MB.Get().(*[]byte)
	buffer := *bufPtr
	defer func() {
		e2ee.Zeroize(buffer)
		chunkPool4MB.Put(bufPtr)
	}()

	n, readErr := f.ReadAt(buffer, offset)
	if readErr != nil && readErr != io.EOF && n == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "CHUNK_OUT_OF_BOUNDS"})
		return
	}
	plaintext := buffer[:n]

	ciphertext, err := e2ee.EncryptChunk(plaintext, chunkIndex, keys.SendKey[:], fileID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "ENCRYPT_FAILED", "error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Chunk-Index", fmt.Sprintf("%d", chunkIndex))
	w.Header().Set("X-File-ID", fileID)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ciphertext)
}
