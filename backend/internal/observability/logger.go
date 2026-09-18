package observability

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// ANSI escape codes used by the development console formatter.
const (
	ansiReset       = "\x1b[0m"
	ansiBold        = "\x1b[1m"
	ansiDim         = "\x1b[2m"
	ansiItalic      = "\x1b[3m"
	ansiUnderline   = "\x1b[4m"
	ansiFgBlack     = "\x1b[30m"
	ansiFgRed       = "\x1b[31m"
	ansiFgGreen     = "\x1b[32m"
	ansiFgYellow    = "\x1b[33m"
	ansiFgBlue      = "\x1b[34m"
	ansiFgMagenta   = "\x1b[35m"
	ansiFgCyan      = "\x1b[36m"
	ansiFgWhite     = "\x1b[37m"
	ansiFgGray      = "\x1b[90m" // bright-black / dark-gray
	ansiFgBrGreen   = "\x1b[92m"
	ansiFgBrYellow  = "\x1b[93m"
	ansiFgBrBlue    = "\x1b[94m"
	ansiFgBrMagenta = "\x1b[95m"
	ansiFgBrCyan    = "\x1b[96m"
	ansiFgBrWhite   = "\x1b[97m"
	ansiBgRed       = "\x1b[41m"
)

// levelBadge returns a fixed-width, colored level badge.
//
//	TRACE  dark-gray
//	DEBUG  cyan
//	INFO   bright-green  (bold)
//	WARN   bright-yellow (bold)
//	ERROR  bright-red    (bold)
//	FATAL  white-on-red  (bold)
//	PANIC  white-on-red  (bold)
func levelBadge(levelStr interface{}) string {
	l := fmt.Sprintf("%s", levelStr)
	switch strings.ToUpper(strings.TrimSpace(l)) {
	case "TRACE":
		return ansiFgGray + "TRACE" + ansiReset
	case "DEBUG":
		return ansiFgCyan + "DEBUG" + ansiReset
	case "INFO":
		return ansiBold + ansiFgBrGreen + " INF " + ansiReset
	case "WARN":
		return ansiBold + ansiFgBrYellow + "WARN " + ansiReset
	case "WARNING":
		return ansiBold + ansiFgBrYellow + "WARN " + ansiReset
	case "ERROR":
		return ansiBold + ansiFgRed + "ERROR" + ansiReset
	case "FATAL":
		return ansiBold + ansiBgRed + ansiFgBrWhite + "FATAL" + ansiReset
	case "PANIC":
		return ansiBold + ansiBgRed + ansiFgBrWhite + "PANIC" + ansiReset
	default:
		return ansiFgGray + fmt.Sprintf("%-5s", l) + ansiReset
	}
}

// newConsoleWriter builds a zerolog.ConsoleWriter with full color hierarchy.
func newConsoleWriter(out io.Writer) zerolog.ConsoleWriter {
	return zerolog.ConsoleWriter{
		Out:        out,
		TimeFormat: "15:04:05",
		NoColor:    false,

		// Level badge: fixed-width, color-coded.
		FormatLevel: levelBadge,

		// Message: bold white.
		FormatMessage: func(i interface{}) string {
			return ansiBold + ansiFgBrWhite + fmt.Sprintf("%s", i) + ansiReset
		},

		// Field names: dim + color to distinguish from values.
		FormatFieldName: func(i interface{}) string {
			return ansiDim + ansiFgCyan + fmt.Sprintf("%s=", i) + ansiReset
		},

		// Field values: plain (color already on key makes it scannable).
		FormatFieldValue: func(i interface{}) string {
			return fmt.Sprintf("%s", i)
		},

		// Caller: dim + italic, basename:line only for brevity.
		FormatCaller: func(i interface{}) string {
			s := fmt.Sprintf("%s", i)
			// zerolog caller is "file.go:line" or absolute — keep basename.
			if s != "" {
				s = filepath.Base(s)
			}
			return ansiDim + ansiItalic + ansiFgGray + s + ansiReset
		},

		// Timestamp: dim gray — less visual weight than the level badge.
		FormatTimestamp: func(i interface{}) string {
			return ansiDim + ansiFgGray + fmt.Sprintf("%s", i) + ansiReset
		},

		// Error value: highlight in red.
		FormatErrFieldValue: func(i interface{}) string {
			return ansiFgRed + fmt.Sprintf("%s", i) + ansiReset
		},
	}
}

// NewLogger emits colorized logs for local development and JSON for every
// deployed environment. JSON written to stdout is safe for Better Stack,
// Render log streams, Docker collectors, and other log drains.
//
// Level hierarchy (development):
//
//	TRACE  ░ dark-gray
//	DEBUG  ▒ cyan
//	 INF   ▓ bold bright-green
//	WARN   ▓ bold bright-yellow
//	ERROR  █ bold red
//	FATAL  █ bold white-on-red
func NewLogger(appEnv string, output io.Writer) zerolog.Logger {
	if output == nil {
		output = os.Stdout
	}

	// Standardize JSON field names once, globally.
	// These are the keys BetterStack (and most log drains) recognise natively:
	//   dt / time  → timestamp index
	//   level      → severity filter
	//   message    → primary log line
	//   error      → error detail
	zerolog.TimeFieldFormat = time.RFC3339
	zerolog.TimestampFieldName = "time"  // canonical timestamp field
	zerolog.LevelFieldName = "level"     // standard; BetterStack uses this for severity
	zerolog.MessageFieldName = "message" // BetterStack also accepts "message" (not only "msg")
	zerolog.ErrorFieldName = "error"     // searchable error field

	if strings.EqualFold(appEnv, "development") {
		output = newConsoleWriter(output)
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
