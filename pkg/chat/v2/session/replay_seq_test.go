package session

import "testing"

func TestResolveReplayStartSeq(t *testing.T) {
	tests := []struct {
		name       string
		afterSeq   int64
		joinSeq    int64
		currentSeq int64
		want       int64
	}{
		{
			name:       "brand new client both zero",
			afterSeq:   0,
			joinSeq:    0,
			currentSeq: 42,
			want:       42,
		},
		{
			name:       "warm reconnect high watermark",
			afterSeq:   40,
			joinSeq:    5,
			currentSeq: 40,
			want:       40,
		},
		{
			name:       "cold start client sends afterSeq equal joinSeq",
			afterSeq:   5,
			joinSeq:    5,
			currentSeq: 40,
			want:       5,
		},
		{
			name:       "afterSeq below joinSeq clamps to joinSeq",
			afterSeq:   2,
			joinSeq:    10,
			currentSeq: 40,
			want:       10,
		},
		{
			name:       "only afterSeq set",
			afterSeq:   7,
			joinSeq:    0,
			currentSeq: 20,
			want:       7,
		},
		{
			name:       "only joinSeq set (afterSeq zero)",
			afterSeq:   0,
			joinSeq:    9,
			currentSeq: 20,
			want:       9,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveReplayStartSeq(tt.afterSeq, tt.joinSeq, tt.currentSeq)
			if got != tt.want {
				t.Fatalf("ResolveReplayStartSeq(%d, %d, %d) = %d, want %d",
					tt.afterSeq, tt.joinSeq, tt.currentSeq, got, tt.want)
			}
		})
	}
}
