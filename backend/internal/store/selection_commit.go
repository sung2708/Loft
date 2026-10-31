package store

import (
	"context"
	"errors"
	"fmt"
)

var ErrSelectionCommitPending = errors.New("music change is awaiting confirmation")

// COMMIT can succeed even when its acknowledgement is lost. Never infer rollback.
type SelectionCommitPendingError struct {
	TransactionID string
	Cause         error
}

func (e *SelectionCommitPendingError) Error() string {
	return fmt.Sprintf("%s: %v", ErrSelectionCommitPending, e.Cause)
}
func (e *SelectionCommitPendingError) Unwrap() error { return ErrSelectionCommitPending }

type SelectionCommitStatus string

const (
	SelectionCommitted  SelectionCommitStatus = "committed"
	SelectionAborted    SelectionCommitStatus = "aborted"
	SelectionInProgress SelectionCommitStatus = "in progress"
)

func (p *Postgres) YouTubeSelectionStatus(ctx context.Context, transactionID string) (SelectionCommitStatus, error) {
	var status *string
	if err := p.pool.QueryRow(ctx, `SELECT pg_xact_status($1::xid8)`, transactionID).Scan(&status); err != nil {
		return "", err
	}
	if status == nil {
		return "", ErrSelectionCommitPending
	}
	switch SelectionCommitStatus(*status) {
	case SelectionCommitted, SelectionAborted, SelectionInProgress:
		return SelectionCommitStatus(*status), nil
	default:
		return "", ErrSelectionCommitPending
	}
}
