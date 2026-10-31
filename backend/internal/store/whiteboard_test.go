package store

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestBoardPatchPreservesOtherWritersAndRejectsStaleVersion(t *testing.T) {
	initial := BoardSnapshot{Records: map[string]json.RawMessage{}}
	first, err := ApplyBoardPatch(initial, BoardPatch{Put: []json.RawMessage{testBoardRecord(t, "a")}})
	if err != nil {
		t.Fatal(err)
	}
	stale, err := ApplyBoardPatch(first, BoardPatch{Version: 0, Remove: []string{"shape:a"}})
	if !errors.Is(err, ErrBoardConflict) || len(stale.Records) != 1 {
		t.Fatal("stale client overwrote board")
	}
	second, err := ApplyBoardPatch(first, BoardPatch{Version: 1, Put: []json.RawMessage{testBoardRecord(t, "b")}})
	if err != nil || len(second.Records) != 2 {
		t.Fatalf("concurrent shape lost: %v", err)
	}
	if len(initial.Records) != 0 || len(first.Records) != 1 {
		t.Fatal("patch mutated input snapshot")
	}
}
func TestBoardRejectsUploadsAndInvalidRecords(t *testing.T) {
	for _, raw := range []string{`{"id":"asset:a","typeName":"asset"}`, `{"id":"shape:a","typeName":"shape","type":"image"}`, `{"id":"page:a","typeName":"shape","type":"draw"}`, `null`} {
		_, err := ApplyBoardPatch(BoardSnapshot{Records: map[string]json.RawMessage{}}, BoardPatch{Put: []json.RawMessage{json.RawMessage(raw)}})
		if err == nil {
			t.Fatalf("invalid record accepted: %s", raw)
		}
	}
}

func TestBoardLimitsAndDeletion(t *testing.T) {
	snapshot := BoardSnapshot{Records: map[string]json.RawMessage{}}
	patch := BoardPatch{Put: make([]json.RawMessage, 201)}
	if _, err := ApplyBoardPatch(snapshot, patch); !errors.Is(err, ErrBoardLimit) {
		t.Fatal("unbounded patch accepted")
	}
	snapshot.Records["shape:a"] = testBoardRecord(t, "a")
	result, err := ApplyBoardPatch(snapshot, BoardPatch{Remove: []string{"shape:a"}})
	if err != nil || len(result.Records) != 0 {
		t.Fatalf("erase failed: %v", err)
	}
	if _, err = ApplyBoardPatch(snapshot, BoardPatch{Remove: []string{"page:page"}}); !errors.Is(err, ErrBoardInvalid) {
		t.Fatal("page deletion accepted")
	}
}

func testBoardRecord(t *testing.T, id string) json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile("testdata/board_records.json")
	if err != nil {
		t.Fatal(err)
	}
	var records []json.RawMessage
	if err = json.Unmarshal(raw, &records); err != nil {
		t.Fatal(err)
	}
	return json.RawMessage(strings.Replace(string(records[0]), "shape:draw", "shape:"+id, 1))
}
func TestBoardSDKFixturesAndMalformedProps(t *testing.T) {
	raw, err := os.ReadFile("testdata/board_records.json")
	if err != nil {
		t.Fatal(err)
	}
	var records []json.RawMessage
	_ = json.Unmarshal(raw, &records)
	for _, record := range records {
		if !validBoardRecord(record) {
			t.Fatalf("SDK record rejected: %s", record)
		}
	}
	for _, record := range []json.RawMessage{
		json.RawMessage(`{"id":"shape:a","typeName":"shape","type":"draw"}`),
		json.RawMessage(strings.Replace(string(records[0]), `"scale": 1`, `"scale": 0`, 1)),
		json.RawMessage(strings.Replace(string(records[0]), `"color": "black"`, `"color": "invalid"`, 1)),
	} {
		if validBoardRecord(record) {
			t.Fatalf("malformed record accepted: %s", record)
		}
	}
}

func TestBoardDrawPathsMustBeDecodableAndFinite(t *testing.T) {
	for _, path := range []string{"not-base64", "AA==", "AACAfwAAAAAAAAAA"} {
		if validBoardPath(path, 3) {
			t.Fatal("unsafe draw path accepted", path)
		}
	}
	if !validBoardPath("AAAAAAAAAAAAAAAA", 3) || !validBoardPath("AAAAAAAAAAA=", 2) {
		t.Fatal("valid draw path rejected")
	}
}

func TestBoardRejectsParentCyclesAcrossWholeSnapshot(t *testing.T) {
	shape := func(id, parent string) json.RawMessage {
		var record map[string]json.RawMessage
		if err := json.Unmarshal(testBoardRecord(t, id), &record); err != nil {
			t.Fatal(err)
		}
		record["parentId"], _ = json.Marshal(parent)
		raw, _ := json.Marshal(record)
		return raw
	}
	initial := BoardSnapshot{Records: map[string]json.RawMessage{}}
	for _, put := range [][]json.RawMessage{
		{shape("a", "shape:a")},
		{shape("a", "shape:b"), shape("b", "shape:a")},
		{shape("a", "shape:b"), shape("b", "shape:c"), shape("c", "shape:a")},
	} {
		if _, err := ApplyBoardPatch(initial, BoardPatch{Put: put}); !errors.Is(err, ErrBoardInvalid) {
			t.Fatal("cyclic parents accepted")
		}
	}
	first, err := ApplyBoardPatch(initial, BoardPatch{Put: []json.RawMessage{shape("a", "shape:b"), shape("b", "page:page")}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ApplyBoardPatch(first, BoardPatch{Version: first.Version, Put: []json.RawMessage{shape("b", "shape:a")}}); !errors.Is(err, ErrBoardInvalid) {
		t.Fatal("cycle through an existing record accepted")
	}
	// A removal can repair a legacy cycle without deleting unrelated records.
	legacy := BoardSnapshot{Records: map[string]json.RawMessage{"shape:a": shape("a", "shape:b"), "shape:b": shape("b", "shape:a")}}
	if _, err = ApplyBoardPatch(legacy, BoardPatch{Put: []json.RawMessage{shape("safe", "page:page")}}); err != nil {
		t.Fatal("legacy cycle blocked an unrelated edit", err)
	}
	if _, err = ApplyBoardPatch(legacy, BoardPatch{Put: []json.RawMessage{shape("child", "shape:a")}}); !errors.Is(err, ErrBoardInvalid) {
		t.Fatal("new child of a legacy cycle accepted")
	}
	if _, err = ApplyBoardPatch(legacy, BoardPatch{Remove: []string{"shape:a"}}); err != nil {
		t.Fatal("could not repair legacy cycle", err)
	}
}

func TestBoardRichTextUsesExactNodeAndMarkTypes(t *testing.T) {
	for _, text := range []string{
		`{"type":"doc","content":[{"type":"paragraph heading"}]}`,
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi","marks":[{"type":"bold italic"}]}]}]}`,
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi","marks":[{"type":"link highlight"}]}]}]}`,
	} {
		if validBoardText(json.RawMessage(text), "", 0) {
			t.Fatalf("invalid rich text accepted: %s", text)
		}
	}
	valid := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi","marks":[{"type":"bold"},{"type":"italic"}]}]}]}`)
	if !validBoardText(valid, "", 0) {
		t.Fatal("supported formatting rejected")
	}
}
