package observability

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestProductionLoggerEmitsJSONWithTimestampAndCaller(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("production", &output)
	logger.Info().Msg("test event")

	var entry map[string]any
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatalf("production log is not JSON: %v", err)
	}
	for _, key := range []string{"time", "caller", "message"} {
		if _, ok := entry[key]; !ok {
			t.Fatalf("production log is missing %q: %#v", key, entry)
		}
	}
}

func TestDevelopmentLoggerUsesReadableConsoleOutput(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("development", &output)
	logger.Info().Msg("test event")
	if !bytes.Contains(output.Bytes(), []byte("test event")) {
		t.Fatalf("development log does not contain message: %q", output.String())
	}
}
