package youtube

import "testing"

func TestVideoID(t *testing.T) {
	valid := []string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?t=10",
		"https://m.youtube.com/shorts/dQw4w9WgXcQ",
	}
	for _, raw := range valid {
		if got, err := VideoID(raw); err != nil || got != "dQw4w9WgXcQ" {
			t.Errorf("VideoID(%q) = %q, %v", raw, got, err)
		}
	}
	invalid := []string{
		"http://youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
		"https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube.com:443/watch?v=dQw4w9WgXcQ",
		"https://www.youtube.com/watch?v=short",
		"https://example.com/watch?v=dQw4w9WgXcQ",
	}
	for _, raw := range invalid {
		if _, err := VideoID(raw); err == nil {
			t.Errorf("VideoID(%q) accepted invalid URL", raw)
		}
	}
}
