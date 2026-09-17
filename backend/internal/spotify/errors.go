package spotify

import "time"

type ErrorKind string

const (
	ErrorAuth        ErrorKind = "AUTH"
	ErrorForbidden   ErrorKind = "FORBIDDEN"
	ErrorRateLimited ErrorKind = "RATE_LIMITED"
	ErrorQuota       ErrorKind = "QUOTA"
	ErrorUnavailable ErrorKind = "UNAVAILABLE"
)

type ProviderError struct {
	Kind       ErrorKind
	StatusCode int
	RetryAfter time.Duration
	Message    string
}

func (e *ProviderError) Error() string { return e.Message }

func NormalizeError(status int, retryAfter time.Duration, quota bool, message string) *ProviderError {
	kind := ErrorUnavailable
	switch {
	case status == 401:
		kind = ErrorAuth
	case status == 403:
		kind = ErrorForbidden
	case status == 429 && quota:
		kind = ErrorQuota
	case status == 429:
		kind = ErrorRateLimited
	}
	return &ProviderError{Kind: kind, StatusCode: status, RetryAfter: retryAfter, Message: message}
}
