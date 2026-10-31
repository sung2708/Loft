package realtime

import (
	"math"
	"testing"
)

func TestBoardCursorRejectsUnboundedCoordinates(t *testing.T) {
	for _, value := range []float64{math.NaN(), math.Inf(1), 1e20} {
		if validBoardCursor(boardCursor{X: value}) {
			t.Fatal("invalid coordinate accepted")
		}
	}
	if !validBoardCursor(boardCursor{X: 123, Y: -200}) {
		t.Fatal("valid cursor rejected")
	}
}
