package observability

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// NewLogger emits colourized logs for local development and JSON for every
// deployed environment. JSON written to stdout is safe for Better Stack,
// Render log streams, Docker collectors, and other log drains.
func NewLogger(appEnv string, output io.Writer) zerolog.Logger {
	if output == nil {
		output = os.Stdout
	}
	zerolog.TimeFieldFormat = time.RFC3339
	if strings.EqualFold(appEnv, "development") {
		output = zerolog.ConsoleWriter{Out: output, TimeFormat: time.RFC3339, NoColor: false}
	}
	return zerolog.New(output).With().Timestamp().Caller().Logger()
}

// SlogLogger adapts existing package constructors to Zerolog while the
// application transitions away from log/slog. It keeps one output format and
// one correlation schema rather than maintaining two unrelated log streams.
func SlogLogger(logger zerolog.Logger) *slog.Logger {
	return slog.New(&slogHandler{logger: logger})
}

type slogHandler struct {
	logger zerolog.Logger
	attrs  []slog.Attr
	group  string
}

func (h *slogHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *slogHandler) Handle(ctx context.Context, record slog.Record) error {
	logger := h.logger
	if contextual := zerolog.Ctx(ctx); contextual != nil {
		logger = *contextual
	}
	event := logger.WithLevel(toZeroLevel(record.Level))
	appendAttrs(event, h.attrs, h.group)
	record.Attrs(func(attr slog.Attr) bool {
		appendAttr(event, attr, h.group)
		return true
	})
	event.Msg(record.Message)
	return nil
}

func (h *slogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *h
	clone.attrs = append(append([]slog.Attr(nil), h.attrs...), attrs...)
	return &clone
}

func (h *slogHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	clone := *h
	if clone.group == "" {
		clone.group = name
	} else {
		clone.group += "." + name
	}
	return &clone
}

func toZeroLevel(level slog.Level) zerolog.Level {
	switch {
	case level <= slog.LevelDebug:
		return zerolog.DebugLevel
	case level < slog.LevelWarn:
		return zerolog.InfoLevel
	case level < slog.LevelError:
		return zerolog.WarnLevel
	default:
		return zerolog.ErrorLevel
	}
}

func appendAttrs(event *zerolog.Event, attrs []slog.Attr, group string) {
	for _, attr := range attrs {
		appendAttr(event, attr, group)
	}
}

func appendAttr(event *zerolog.Event, attr slog.Attr, group string) {
	attr.Value = attr.Value.Resolve()
	if attr.Key == "" {
		return
	}
	if attr.Value.Kind() == slog.KindGroup {
		nextGroup := attr.Key
		if group != "" {
			nextGroup = group + "." + attr.Key
		}
		appendAttrs(event, attr.Value.Group(), nextGroup)
		return
	}
	key := attr.Key
	if group != "" {
		key = group + "." + key
	}
	switch attr.Value.Kind() {
	case slog.KindString:
		event.Str(key, attr.Value.String())
	case slog.KindInt64:
		event.Int64(key, attr.Value.Int64())
	case slog.KindUint64:
		event.Uint64(key, attr.Value.Uint64())
	case slog.KindBool:
		event.Bool(key, attr.Value.Bool())
	case slog.KindFloat64:
		event.Float64(key, attr.Value.Float64())
	case slog.KindTime:
		event.Time(key, attr.Value.Time())
	case slog.KindDuration:
		event.Dur(key, attr.Value.Duration())
	default:
		event.Any(key, attr.Value.Any())
	}
}
