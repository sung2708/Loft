package store

import (
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"net/url"
	"strings"
)

// Pinned to tldraw 5.6.0; SDK fixture tests guard upgrades to its record schema.
//
//go:embed board_props.json
var boardPropsJSON []byte

type boardPropRule struct {
	Kind     string   `json:"kind"`
	Values   []string `json:"values"`
	Zero     bool     `json:"zero"`
	Negative bool     `json:"negative"`
	Nullable bool     `json:"nullable"`
}

var boardProps = func() map[string]map[string]boardPropRule {
	var rules map[string]map[string]boardPropRule
	if err := json.Unmarshal(boardPropsJSON, &rules); err != nil {
		panic(err)
	}
	return rules
}()

type boardObject map[string]json.RawMessage

func (o boardObject) text(key string) string { var s string; _ = json.Unmarshal(o[key], &s); return s }
func boardString(raw json.RawMessage) bool {
	var v string
	return len(raw) > 0 && string(raw) != "null" && json.Unmarshal(raw, &v) == nil
}
func boardNumber(raw json.RawMessage) (float64, bool) {
	var n float64
	err := json.Unmarshal(raw, &n)
	return n, len(raw) > 0 && string(raw) != "null" && err == nil && !math.IsInf(n, 0) && !math.IsNaN(n)
}
func boardBool(raw json.RawMessage) bool {
	var b bool
	return len(raw) > 0 && string(raw) != "null" && json.Unmarshal(raw, &b) == nil
}
func boardFields(raw json.RawMessage, required, optional string) (boardObject, bool) {
	var o boardObject
	if json.Unmarshal(raw, &o) != nil || o == nil {
		return nil, false
	}
	for _, k := range strings.Fields(required) {
		if _, ok := o[k]; !ok {
			return nil, false
		}
	}
	allowed := " " + required + " " + optional + " "
	for k := range o {
		if !strings.Contains(allowed, " "+k+" ") {
			return nil, false
		}
	}
	return o, true
}
func boardID(id, prefix string) bool {
	return strings.HasPrefix(id, prefix+":") && len(id) > len(prefix)+1 && len(id) <= 128
}
func boardIndex(raw json.RawMessage) bool {
	var s string
	if json.Unmarshal(raw, &s) != nil || len(s) < 2 {
		return false
	}
	length := 0
	if s[0] >= 'a' && s[0] <= 'z' {
		length = int(s[0]-'a') + 2
	} else if s[0] >= 'A' && s[0] <= 'Z' {
		length = int('Z'-s[0]) + 2
	}
	if length == 0 || len(s) < length || (len(s) > length && strings.HasSuffix(s, "0")) || s == "A"+strings.Repeat("0", 26) {
		return false
	}
	for _, c := range s[1:] {
		if !(c >= '0' && c <= '9' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z') {
			return false
		}
	}
	return true
}
func boardVector(raw json.RawMessage) bool {
	o, ok := boardFields(raw, "x y", "z")
	if !ok {
		return false
	}
	for _, k := range []string{"x", "y"} {
		if _, ok := boardNumber(o[k]); !ok {
			return false
		}
	}
	if z, exists := o["z"]; exists {
		_, ok = boardNumber(z)
	}
	return ok
}
func validBoardProp(raw json.RawMessage, r boardPropRule) bool {
	switch r.Kind {
	case "string":
		return boardString(raw)
	case "boolean":
		return boardBool(raw)
	case "number":
		if string(raw) == "null" {
			return r.Nullable
		}
		n, ok := boardNumber(raw)
		return ok && (r.Zero || n != 0) && (r.Negative || n >= 0)
	case "enum":
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return false
		}
		for _, v := range r.Values {
			if s == v {
				return true
			}
		}
		return false
	case "textLastEditedBy":
		return string(raw) == "null" || boardString(raw)
	case "start", "end":
		return boardVector(raw)
	case "url":
		if !boardString(raw) {
			return false
		}
		var s string
		_ = json.Unmarshal(raw, &s)
		if s == "" {
			return true
		}
		u, err := url.Parse(s)
		return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
	case "richText":
		return validBoardText(raw, "", 0)
	case "segments":
		var items []json.RawMessage
		if string(raw) == "null" || json.Unmarshal(raw, &items) != nil {
			return false
		}
		for _, item := range items {
			o, ok := boardFields(item, "type path", "dim")
			if !ok || !boardString(o["path"]) || (o.text("type") != "free" && o.text("type") != "straight") {
				return false
			}
			dimension := 3
			if d, exists := o["dim"]; exists {
				n, ok := boardNumber(d)
				if !ok || (n != 2 && n != 3) {
					return false
				}
				dimension = int(n)
			}
			if !validBoardPath(o.text("path"), dimension) {
				return false
			}
		}
		return true
	case "points":
		var points boardObject
		if json.Unmarshal(raw, &points) != nil || points == nil {
			return false
		}
		for _, point := range points {
			o, ok := boardFields(point, "id index x y", "")
			if !ok || !boardString(o["id"]) || !boardIndex(o["index"]) {
				return false
			}
			for _, k := range []string{"x", "y"} {
				if _, ok := boardNumber(o[k]); !ok {
					return false
				}
			}
		}
		return true
	}
	return false
}
func validBoardRecord(raw json.RawMessage) bool {
	var o boardObject
	if json.Unmarshal(raw, &o) != nil || o == nil {
		return false
	}
	kind := o.text("typeName")
	if !boardID(o.text("id"), kind) {
		return false
	}
	// Meta is JSON in the SDK; requiring an object keeps this boundary stricter.
	var meta boardObject
	if json.Unmarshal(o["meta"], &meta) != nil || meta == nil {
		return false
	}
	switch kind {
	case "page":
		_, ok := boardFields(raw, "id typeName name index meta", "")
		return ok && boardString(o["name"]) && boardIndex(o["index"])
	case "document":
		_, ok := boardFields(raw, "id typeName name gridSize meta", "")
		_, num := boardNumber(o["gridSize"])
		return ok && num && o.text("id") == "document:document" && boardString(o["name"])
	case "binding":
		_, ok := boardFields(raw, "id typeName type fromId toId props meta", "")
		if !ok || o.text("type") != "arrow" || !boardID(o.text("fromId"), "shape") || !boardID(o.text("toId"), "shape") {
			return false
		}
		p, ok := boardFields(o["props"], "terminal normalizedAnchor isExact isPrecise snap", "")
		return ok && (p.text("terminal") == "start" || p.text("terminal") == "end") && boardVector(p["normalizedAnchor"]) && boardBool(p["isExact"]) && boardBool(p["isPrecise"]) && (p.text("snap") == "edge-point" || p.text("snap") == "none" || p.text("snap") == "edge" || p.text("snap") == "center")
	case "shape":
		_, ok := boardFields(raw, "id typeName type x y rotation index parentId isLocked opacity props meta", "")
		rules, supported := boardProps[o.text("type")]
		if !ok || !supported || !boardIndex(o["index"]) || !boardBool(o["isLocked"]) || !(boardID(o.text("parentId"), "shape") || boardID(o.text("parentId"), "page")) {
			return false
		}
		for _, k := range []string{"x", "y", "rotation"} {
			if _, ok := boardNumber(o[k]); !ok {
				return false
			}
		}
		opacity, ok := boardNumber(o["opacity"])
		if !ok || opacity < 0 || opacity > 1 {
			return false
		}
		var props boardObject
		if json.Unmarshal(o["props"], &props) != nil || props == nil || len(props) != len(rules) {
			return false
		}
		for key, rule := range rules {
			if !validBoardProp(props[key], rule) {
				return false
			}
		}
		return true
	}
	return false
}

// tldraw stores a Float32 starting point followed by Float16 deltas.
func validBoardPath(path string, dimension int) bool {
	if path == "" {
		return true
	}
	data, err := base64.StdEncoding.DecodeString(path)
	first, delta := dimension*4, dimension*2
	if err != nil || len(data) < first || (len(data)-first)%delta != 0 {
		return false
	}
	for i := 0; i < first; i += 4 {
		n := float64(math.Float32frombits(binary.LittleEndian.Uint32(data[i:])))
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return false
		}
	}
	for i := first; i < len(data); i += 2 {
		if binary.LittleEndian.Uint16(data[i:])&0x7c00 == 0x7c00 {
			return false
		}
	}
	return true
}

func validBoardText(raw json.RawMessage, parent string, depth int) bool {
	if depth > 32 {
		return false
	}
	node, ok := boardFields(raw, "type", "content attrs text marks")
	if !ok {
		return false
	}
	kind := node.text("type")
	allowed := ""
	switch parent {
	case "":
		allowed = "doc"
	case "doc", "listItem":
		allowed = "paragraph heading bulletList orderedList"
	case "bulletList", "orderedList":
		allowed = "listItem"
	case "paragraph", "heading":
		allowed = "text hardBreak"
	default:
		return false
	}
	if !boardEnum(kind, allowed) {
		return false
	}
	if attrs, exists := node["attrs"]; exists {
		var values boardObject
		if json.Unmarshal(attrs, &values) != nil || values == nil {
			return false
		}
		if level, exists := values["level"]; exists {
			n, ok := boardNumber(level)
			if !ok || n < 1 || n > 6 || n != math.Trunc(n) {
				return false
			}
		}
	}
	if marks, exists := node["marks"]; exists {
		var values []json.RawMessage
		if json.Unmarshal(marks, &values) != nil || string(marks) == "null" {
			return false
		}
		for _, raw := range values {
			mark, ok := boardFields(raw, "type", "attrs")
			if !ok || !boardEnum(mark.text("type"), "bold italic strike code underline link highlight") {
				return false
			}
		}
	}
	if kind == "text" {
		return boardString(node["text"]) && node.text("text") != "" && node["content"] == nil
	}
	if node["text"] != nil {
		return false
	}
	if kind == "hardBreak" {
		return node["content"] == nil
	}
	var children []json.RawMessage
	if content, exists := node["content"]; exists {
		if string(content) == "null" || json.Unmarshal(content, &children) != nil {
			return false
		}
	}
	if (kind == "doc" || kind == "bulletList" || kind == "orderedList" || kind == "listItem") && len(children) == 0 {
		return false
	}
	if kind == "listItem" {
		var first boardObject
		if json.Unmarshal(children[0], &first) != nil || first.text("type") != "paragraph" {
			return false
		}
	}
	for _, child := range children {
		if !validBoardText(child, kind, depth+1) {
			return false
		}
	}
	return true
}

func boardEnum(value, allowed string) bool {
	for _, item := range strings.Fields(allowed) {
		if item == value {
			return true
		}
	}
	return false
}
