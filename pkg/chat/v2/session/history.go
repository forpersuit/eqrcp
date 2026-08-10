package session

import "eqt/pkg/chat/v2/protocol"

// DefaultHistoryPageSize is how many message events are delivered per
// connect replay or load_history page.
const DefaultHistoryPageSize = 100

// MaxHistoryPageSize caps client-requested page sizes.
const MaxHistoryPageSize = 200

// NormalizeHistoryLimit returns a safe page size.
func NormalizeHistoryLimit(limit int) int {
	if limit <= 0 {
		return DefaultHistoryPageSize
	}
	if limit > MaxHistoryPageSize {
		return MaxHistoryPageSize
	}
	return limit
}

// SelectMessageHistoryPage returns up to limit newest message events with
// seq > afterSeq and (if beforeSeq > 0) seq < beforeSeq, in ascending seq order.
// hasMore is true when older message events still exist above afterSeq.
func (s *MessageStore) SelectMessageHistoryPage(afterSeq, beforeSeq int64, limit int) (page []protocol.EventEnvelope, hasMore bool) {
	limit = NormalizeHistoryLimit(limit)

	s.mu.RLock()
	defer s.mu.RUnlock()

	var matched []protocol.EventEnvelope
	for _, e := range s.events {
		if e.Message == nil {
			continue
		}
		if e.Seq <= afterSeq {
			continue
		}
		if beforeSeq > 0 && e.Seq >= beforeSeq {
			continue
		}
		matched = append(matched, e)
	}

	if len(matched) > limit {
		hasMore = true
		matched = matched[len(matched)-limit:]
	}
	return matched, hasMore
}
