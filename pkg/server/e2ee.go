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
	mu                sync.Mutex
	FileID            string
	FileName          string
	TargetDir         string
	TempPath          string
	FinalPath         string
	TotalBytes        int64
	TotalChunks       uint32
	ReceivedChunks    map[uint32]bool
	File              *os.File
	ClientID          string
	FileIndex         int
	FileCount         int
	SessionTotalBytes int64
	Completed         bool
	Cancelled         bool
	CreatedAt         time.Time
	ActiveWriters     int
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

	keyB64 := base64.RawURLEncoding.EncodeToString(masterKey)
	if s.SendURL != "" && !strings.Contains(s.SendURL, "#master_key=") {
		s.SendURL = fmt.Sprintf("%s#master_key=%s", s.SendURL, keyB64)
	}
	if s.ReceiveURL != "" && !strings.Contains(s.ReceiveURL, "#master_key=") {
		s.ReceiveURL = fmt.Sprintf("%s#master_key=%s", s.ReceiveURL, keyB64)
	}
	if s.ChatURL != "" && !strings.Contains(s.ChatURL, "#master_key=") {
		s.ChatURL = fmt.Sprintf("%s#master_key=%s", s.ChatURL, keyB64)
	}
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

	s.updateClientStatus(clientID, nil, func(cs *ClientTransferStateInfo) {
		cs.IsBanned = true
		cs.State = "banned"
		cs.Message = "Device transfer has been blocked by host."
	})
	s.triggerStatusHookThrottled()
}

// UnbanClient removes the ban on a client instance.
func (s *Server) UnbanClient(clientID string) {
	if clientID == "" {
		return
	}
	s.sessionBannedMu.Lock()
	if s.sessionBannedClients != nil {
		delete(s.sessionBannedClients, clientID)
	}
	s.sessionBannedMu.Unlock()

	s.updateClientStatus(clientID, nil, func(cs *ClientTransferStateInfo) {
		cs.IsBanned = false
		if cs.State == "banned" {
			cs.State = "waiting"
			cs.Message = ""
		}
	})
	s.triggerStatusHookThrottled()
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

	isStopped := false
	s.clientStatesMu.Lock()
	if cs, ok := s.clientStates[clientID]; ok && cs != nil {
		if cs.State == "stopped" || cs.State == "failed" {
			isStopped = true
		}
	}
	s.clientStatesMu.Unlock()
	if isStopped {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":         false,
			"error_code": "CLIENT_STOPPED",
			"error":      "Transfer manually stopped.",
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
	totalAllBytesStr := r.Header.Get("X-Total-All-Bytes")
	if totalAllBytesStr == "" {
		totalAllBytesStr = r.Header.Get("X-Session-Total-Bytes")
	}
	totalAllBytes, _ := strconv.ParseInt(totalAllBytesStr, 10, 64)
	fileCountStr := r.Header.Get("X-File-Count")
	fileCount, _ := strconv.Atoi(fileCountStr)
	fileIdxStr := r.Header.Get("X-File-Index")
	fileIdx, _ := strconv.Atoi(fileIdxStr)

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
			FileID:            fileID,
			FileName:          cleanName,
			TargetDir:         fullTargetDir,
			TempPath:          tempPath,
			FinalPath:         finalPath,
			TotalBytes:        totalBytes,
			TotalChunks:       totalChunks,
			ReceivedChunks:    make(map[uint32]bool),
			File:              file,
			ClientID:          clientID,
			FileIndex:         fileIdx,
			FileCount:         fileCount,
			SessionTotalBytes: totalAllBytes,
			CreatedAt:         time.Now(),
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

	if !isComplete {
		receivedBytes := int64(len(rf.ReceivedChunks)) * int64(E2EEChunkPlaintextSize)
		if rf.TotalBytes > 0 && receivedBytes > rf.TotalBytes {
			receivedBytes = rf.TotalBytes
		}
		s.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
			if rf.FileCount > 1 && len(state.Files) != rf.FileCount {
				state.Files = make([]ClientFileTransferState, rf.FileCount)
				for i := 0; i < rf.FileCount; i++ {
					state.Files[i] = ClientFileTransferState{
						State: "waiting",
					}
				}
			}
			if rf.FileIndex >= 0 && rf.FileIndex < len(state.Files) {
				state.Files[rf.FileIndex].Name = filepath.Base(rf.FinalPath)
				state.Files[rf.FileIndex].State = "transferring"
				state.Files[rf.FileIndex].BytesTotal = rf.TotalBytes
				state.Files[rf.FileIndex].BytesDone = receivedBytes
				state.Files[rf.FileIndex].Percent = transferPercent(receivedBytes, rf.TotalBytes)
			}

			var totalDone int64
			var totalTotal int64
			for _, f := range state.Files {
				totalDone += f.BytesDone
				totalTotal += f.BytesTotal
			}
			if rf.SessionTotalBytes > 0 {
				totalTotal = rf.SessionTotalBytes
				if totalDone == 0 {
					totalDone = receivedBytes
				}
			} else if totalTotal == 0 {
				totalDone = receivedBytes
				totalTotal = rf.TotalBytes
			}

			state.State = "transferring"
			state.Current = filepath.Base(rf.FinalPath)
			state.BytesDone = totalDone
			state.BytesTotal = totalTotal
			state.Percent = transferPercent(state.BytesDone, state.BytesTotal)
			if state.Percent >= 100 && rf.FileCount > 1 && (rf.FileIndex+1) < rf.FileCount {
				state.Percent = (rf.FileIndex * 100) / rf.FileCount
				if state.Percent == 0 && receivedBytes > 0 {
					state.Percent = transferPercent(receivedBytes, rf.TotalBytes) / rf.FileCount
				}
			}
			state.Message = "Receiving encrypted file from connected device."
		})
		s.triggerStatusHookThrottled()
	} else if !rf.Completed {
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

	isStopped := false
	s.clientStatesMu.Lock()
	if cs, ok := s.clientStates[clientID]; ok && cs != nil {
		if cs.State == "stopped" || cs.State == "failed" {
			isStopped = true
		}
	}
	s.clientStatesMu.Unlock()
	if isStopped {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":         false,
			"error_code": "CLIENT_STOPPED",
			"error":      "Transfer manually stopped.",
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
	if rf.FileCount > 1 && len(cs.Files) != rf.FileCount {
		cs.Files = make([]ClientFileTransferState, rf.FileCount)
		for i := 0; i < rf.FileCount; i++ {
			cs.Files[i] = ClientFileTransferState{
				State: "waiting",
			}
		}
	}
	if rf.FileIndex >= 0 && rf.FileIndex < len(cs.Files) {
		cs.Files[rf.FileIndex].Name = filepath.Base(rf.FinalPath)
		cs.Files[rf.FileIndex].State = "completed"
		cs.Files[rf.FileIndex].BytesDone = rf.TotalBytes
		cs.Files[rf.FileIndex].BytesTotal = rf.TotalBytes
		cs.Files[rf.FileIndex].Percent = 100
		cs.Files[rf.FileIndex].Path = rf.FinalPath
	}

	var totalDone int64
	var totalTotal int64
	for _, f := range cs.Files {
		totalDone += f.BytesDone
		totalTotal += f.BytesTotal
	}
	if rf.SessionTotalBytes > 0 {
		totalTotal = rf.SessionTotalBytes
		if totalDone == 0 {
			totalDone = rf.TotalBytes
		}
	} else if totalTotal == 0 {
		totalDone = rf.TotalBytes
		totalTotal = rf.TotalBytes
	}
	cs.BytesDone = totalDone
	cs.BytesTotal = totalTotal
	cs.Percent = transferPercent(cs.BytesDone, cs.BytesTotal)

	if (len(cs.Files) > 1 && len(cs.SavedFiles) < len(cs.Files)) || (rf.FileCount > 1 && len(cs.SavedFiles) < rf.FileCount) {
		cs.State = "transferring"
		totalExpected := len(cs.Files)
		if totalExpected < rf.FileCount {
			totalExpected = rf.FileCount
		}
		cs.Current = fmt.Sprintf("Received %s (%d/%d)", filepath.Base(rf.FinalPath), len(cs.SavedFiles), totalExpected)
		cs.Message = fmt.Sprintf("Received %d of %d files.", len(cs.SavedFiles), totalExpected)
		// Guard against prematurely reporting 100% when more files are pending
		if cs.Percent >= 100 && len(cs.SavedFiles) < totalExpected {
			cs.Percent = (len(cs.SavedFiles) * 100) / totalExpected
			if cs.Percent >= 100 {
				cs.Percent = 99
			}
		}
	} else {
		cs.State = "completed"
		cs.Percent = 100
		cs.Current = "Transfer Complete"
		cs.Message = "Transfer completed."
		if cs.BytesTotal > 0 {
			cs.BytesDone = cs.BytesTotal
		}
	}
	s.clientStatesMu.Unlock()

	s.recordStatus()
	s.triggerStatusHookThrottled()
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

	isStopped := false
	s.clientStatesMu.Lock()
	if cs, ok := s.clientStates[clientID]; ok && cs != nil {
		if cs.State == "stopped" {
			isStopped = true
		}
	}
	s.clientStatesMu.Unlock()
	if isStopped {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":         false,
			"error_code": "CLIENT_STOPPED",
			"error":      "Transfer manually stopped by host.",
		})
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

	var totalExpectedBytes int64
	for _, f := range files {
		totalExpectedBytes += f.FileSize
	}

	s.expectedBytesMu.Lock()
	if s.expectedBytes == nil {
		s.expectedBytes = make(map[int]int64)
	}
	if s.body.Archive || (s.body.Path != "" && len(s.body.Paths) == 0) {
		s.expectedBytes[-1] = totalExpectedBytes
	} else {
		for idx, f := range files {
			s.expectedBytes[idx] = f.FileSize
		}
	}
	s.expectedBytesMu.Unlock()

	s.e2eeShareDeliveredMu.Lock()
	s.clientMutex.Lock()
	if s.e2eeShareDelivered != nil {
		delete(s.e2eeShareDelivered, clientID)
	}
	if s.clientProgress != nil {
		delete(s.clientProgress, clientID)
	}
	s.clientMutex.Unlock()
	s.e2eeShareDeliveredMu.Unlock()

	s.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
		state.State = "connected"
		state.BytesDone = 0
		state.BytesTotal = totalExpectedBytes
		state.Percent = 0
		state.Message = "Connected. Starting encrypted transfer..."
	})
	s.triggerStatusHookThrottled()
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

	isStopped := false
	s.clientStatesMu.Lock()
	if cs, ok := s.clientStates[clientID]; ok && cs != nil {
		if cs.State == "stopped" || cs.State == "failed" {
			isStopped = true
		}
	}
	s.clientStatesMu.Unlock()
	if isStopped {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": "CLIENT_STOPPED", "error": "Transfer manually stopped."})
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

	var fileIndex int
	var filePath string
	var downloadName string

	if s.body.Archive || (s.body.Path != "" && len(s.body.Paths) == 0) {
		fileIndex = -1
		filePath = s.body.Path
		if s.body.Filename != "" {
			downloadName = s.body.Filename
		} else {
			downloadName = filepath.Base(s.body.Path)
		}
	} else {
		n, err := fmt.Sscanf(fileID, "f-%d", &fileIndex)
		if err != nil || n != 1 || fileIndex < 0 || fileIndex >= len(s.body.Paths) {
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
		downloadName = filepath.Base(filePath)
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
	writtenBytes, writeErr := w.Write(ciphertext)
	if writeErr != nil || writtenBytes < len(ciphertext) {
		// Client disconnected or write failed; do not credit progress
		return
	}

	// Chunk-level delivery deduplication to prevent double-counting on retry/refresh
	s.e2eeShareDeliveredMu.Lock()
	s.clientMutex.Lock()
	if s.e2eeShareDelivered == nil {
		s.e2eeShareDelivered = make(map[string]map[int]map[uint32]bool)
	}
	if s.e2eeShareDelivered[clientID] == nil {
		s.e2eeShareDelivered[clientID] = make(map[int]map[uint32]bool)
	}
	if s.e2eeShareDelivered[clientID][fileIndex] == nil {
		s.e2eeShareDelivered[clientID][fileIndex] = make(map[uint32]bool)
	}
	alreadyDelivered := s.e2eeShareDelivered[clientID][fileIndex][chunkIndex]
	if !alreadyDelivered {
		s.e2eeShareDelivered[clientID][fileIndex][chunkIndex] = true
		if s.clientProgress == nil {
			s.clientProgress = make(map[string]map[int]int64)
		}
		if s.clientProgress[clientID] == nil {
			s.clientProgress[clientID] = make(map[int]int64)
		}
		s.clientProgress[clientID][fileIndex] += int64(n)
	}
	s.clientMutex.Unlock()
	s.e2eeShareDeliveredMu.Unlock()

	clientDone, clientTotal := s.getClientDownloadedAndTotal(clientID)

	s.updateClientStatus(clientID, r, func(state *ClientTransferStateInfo) {
		if clientTotal > 0 && clientDone >= clientTotal {
			state.State = "completed"
			state.Percent = 100
			state.BytesDone = clientTotal
			state.BytesTotal = clientTotal
			state.Message = "Transfer completed."
		} else {
			state.State = "transferring"
			state.Current = downloadName
			state.BytesDone = clientDone
			state.BytesTotal = clientTotal
			state.Percent = transferPercent(state.BytesDone, state.BytesTotal)
			state.Message = "Sending encrypted file to connected device."
		}
	})
	s.triggerStatusHookThrottled()

	if clientTotal > 0 && clientDone >= clientTotal {
		allDownloaded := false
		if s.body.Archive {
			allDownloaded = s.markItemDownloaded(-1)
		} else if len(s.body.Paths) > 1 {
			allDownloaded = s.markItemDownloaded(fileIndex)
		} else {
			allDownloaded = s.markItemDownloaded(0)
		}

		if allDownloaded {
			s.statusMu.Lock()
			autoStop := s.autoStop
			s.statusMu.Unlock()
			if autoStop || !s.KeepAlive {
				s.setStatus("completed", "Transfer completed.")
				s.recordStatus()
				go s.signalStopAfterStatusGrace()
			} else {
				s.setStatus("waiting", fmt.Sprintf("Item %s downloaded. Waiting for more connections.", downloadName))
				s.recordStatus()
			}
		}
	}
}

// HandleE2EEReceiveChunk exports handleE2EEReceiveChunk for integration tests.
func (s *Server) HandleE2EEReceiveChunk(w http.ResponseWriter, r *http.Request) {
	s.handleE2EEReceiveChunk(w, r)
}

// HandleE2EEReceiveChunkStatus exports handleE2EEReceiveChunkStatus for integration tests.
func (s *Server) HandleE2EEReceiveChunkStatus(w http.ResponseWriter, r *http.Request) {
	s.handleE2EEReceiveChunkStatus(w, r)
}

// HandleE2EEShareMeta exports handleE2EEShareMeta for integration tests.
func (s *Server) HandleE2EEShareMeta(w http.ResponseWriter, r *http.Request) {
	s.handleE2EEShareMeta(w, r)
}

// HandleE2EEShareChunk exports handleE2EEShareChunk for integration tests.
func (s *Server) HandleE2EEShareChunk(w http.ResponseWriter, r *http.Request) {
	s.handleE2EEShareChunk(w, r)
}

// GetClientStatus exports getClientStatus for integration tests.
func (s *Server) GetClientStatus(clientID string) ClientTransferStateInfo {
	return s.getClientStatus(clientID)
}
