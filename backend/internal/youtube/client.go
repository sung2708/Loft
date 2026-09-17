package youtube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	APIKey     string
	HTTP       *http.Client
	MaxResults int
}

func (c Client) Search(ctx context.Context, query string) (SearchResponse, error) {
	q := strings.TrimSpace(query)
	if q == "" || len([]rune(q)) > 120 {
		return SearchResponse{}, fmt.Errorf("invalid query")
	}
	limit := c.MaxResults
	if limit < 1 || limit > 10 {
		limit = 10
	}
	if c.APIKey == "" {
		return SearchResponse{}, fmt.Errorf("youtube search is not configured")
	}
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/search")
	v := u.Query()
	v.Set("part", "snippet")
	v.Set("type", "video")
	v.Set("maxResults", strconv.Itoa(limit))
	v.Set("q", q)
	v.Set("key", c.APIKey)
	u.RawQuery = v.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return SearchResponse{}, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return SearchResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return SearchResponse{}, fmt.Errorf("youtube provider status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				Title        string `json:"title"`
				ChannelTitle string `json:"channelTitle"`
				Thumbnails   map[string]struct {
					URL string `json:"url"`
				} `json:"thumbnails"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return SearchResponse{}, err
	}
	out := SearchResponse{Query: q, Items: make([]SearchResult, 0, len(payload.Items))}
	for _, item := range payload.Items {
		if item.ID.VideoID == "" {
			continue
		}
		thumb := item.Snippet.Thumbnails["medium"].URL
		if thumb == "" {
			thumb = item.Snippet.Thumbnails["default"].URL
		}
		out.Items = append(out.Items, SearchResult{VideoID: item.ID.VideoID, Title: item.Snippet.Title, Channel: item.Snippet.ChannelTitle, Thumbnail: thumb})
	}
	return out, nil
}
