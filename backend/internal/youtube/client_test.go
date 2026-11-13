package youtube

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSearchRequestsOnlyEmbeddableVideos(t *testing.T) {
	var query string
	client := Client{APIKey: "key", HTTP: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		query = r.URL.RawQuery
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"items":[{"id":{"videoId":"abc"},"snippet":{"title":"T","channelTitle":"C"}}]}`)), Header: http.Header{}}, nil
	})}}
	result, err := client.Search(context.Background(), "lofi")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].VideoID != "abc" {
		t.Fatalf("unexpected result: %+v", result)
	}
	for _, want := range []string{"videoEmbeddable=true", "videoSyndicated=true", "type=video"} {
		if !strings.Contains(query, want) {
			t.Fatalf("query %q missing %s", query, want)
		}
	}
}
