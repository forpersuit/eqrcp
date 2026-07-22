package session

// ResolveReplayStartSeq decides the exclusive sequence cursor used for event
// replay on Register (GetSince(startSeq) returns events with seq > startSeq).
//
// afterSeq: last event the client reports having consumed (watermark).
// joinSeq:  client join boundary; history before this must never be leaked.
// currentSeq: MessageStore.CurrentSeq() when both watermarks are zero (brand-new
//
//	client: do not sync messages sent before this join).
//
// Client cold-start policy (empty in-memory message list) is to pass
// afterSeq == joinSeq so the server rehydrates all post-join history.
func ResolveReplayStartSeq(afterSeq, joinSeq, currentSeq int64) int64 {
	if afterSeq > 0 && joinSeq > 0 {
		if afterSeq >= joinSeq {
			return afterSeq
		}
		return joinSeq
	}
	if afterSeq > 0 {
		return afterSeq
	}
	if joinSeq > 0 {
		return joinSeq
	}
	// Both are 0: brand-new client — no pre-join history.
	return currentSeq
}
