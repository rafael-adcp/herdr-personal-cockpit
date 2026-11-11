// yaml.js reads five constructs and reports everything else by line number.
// The reporting is the point: a parser that silently dropped a line it did not
// understand would turn a typo into a routine that never fires, found weeks
// later. So every test below has a negative twin -- the construct parses, and
// the malformed version of it lands in `problems` with a line number.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../mods/personal-cockpit/kit/yaml.js";

// ---- the five constructs --------------------------------------------------

test("a top-level key and value is config", () => {
  const { top, items, problems } = parse("query: org:acme draft:false");
  assert.deepEqual(top, { query: "org:acme draft:false" });
  assert.deepEqual(items, []);
  assert.deepEqual(problems, []);
});

test("scalars that are not strings are converted", () => {
  const { top } = parse(["yes: true", "no: false", "count: 42", "negative: -7", "nothing: ~", "void: null", "blank:"].join("\n"));
  assert.deepEqual(top, { yes: true, no: false, count: 42, negative: -7, nothing: null, void: null });
  // `blank:` with no value introduces a list rather than setting null -- that
  // is how `routines:` and `people:` are written.
  assert.equal("blank" in top, false);
});

test("a decimal stays a string, because only integers are converted", () => {
  // Locked deliberately: the regex is `^-?\d+$`. A version like 0.1.13 must not
  // become a number, and 1.5 becoming 1.5 would be inconsistent with it.
  assert.deepEqual(parse("version: 1.5").top, { version: "1.5" });
  assert.deepEqual(parse("version: 0.1.13").top, { version: "0.1.13" });
});

test("quotes are stripped, and only a matching pair", () => {
  assert.deepEqual(parse(`a: "hi"`).top, { a: "hi" });
  assert.deepEqual(parse("b: 'hi'").top, { b: "hi" });
  assert.deepEqual(parse(`c: "mismatched'`).top, { c: `"mismatched'` });
});

test("a list of bare names keeps the order it was written in", () => {
  // The order is load-bearing: it is the order of the groups in the panel.
  const { items, problems } = parse(["people:", "  - alice", "  - bob", "  - carol"].join("\n"));
  assert.deepEqual(items, ["alice", "bob", "carol"]);
  assert.deepEqual(problems, []);
});

test("a list of maps collects each item's keys", () => {
  const { items, problems } = parse(
    ["routines:", "  - title: Prune branches", "    project: chores", "  - title: Flaky tests", "    project: ci"].join("\n"),
  );
  assert.deepEqual(items, [
    { title: "Prune branches", project: "chores" },
    { title: "Flaky tests", project: "ci" },
  ]);
  assert.deepEqual(problems, []);
});

test("a block scalar keeps its newlines and is dedented", () => {
  const { items } = parse(
    ["routines:", "  - title: One", "    goal: |", "      first line", "      second line"].join("\n"),
  );
  assert.equal(items[0].goal, "first line\nsecond line");
});

test("a block scalar keeps relative indentation inside it", () => {
  const { items } = parse(
    ["routines:", "  - title: One", "    goal: |", "      - a bullet", "        continued"].join("\n"),
  );
  assert.equal(items[0].goal, "- a bullet\n  continued");
});

test("|- and > read the same as | -- a deliberate simplification", () => {
  const body = ["routines:", "  - title: One", "    goal: KIND", "      kept"].join("\n");
  for (const kind of ["|", "|-", ">"]) {
    assert.equal(parse(body.replace("KIND", kind)).items[0].goal, "kept", kind);
  }
});

test("a comment is removed, and a # inside a value survives", () => {
  assert.deepEqual(parse("a: hi # a note").top, { a: "hi" });
  assert.deepEqual(parse("# whole line").top, {});
  // No whitespace before it, so it is not a comment: `C#`, a URL fragment.
  assert.deepEqual(parse("lang: C#").top, { lang: "C#" });
  assert.deepEqual(parse("url: http://x/y#frag").top, { url: "http://x/y#frag" });
});

test("a # inside a block scalar is prose, not a comment", () => {
  const { items } = parse(["routines:", "  - title: One", "    goal: |", "      fix the # parsing"].join("\n"));
  assert.equal(items[0].goal, "fix the # parsing");
});

test("CRLF line endings read the same as LF", () => {
  assert.deepEqual(parse("a: 1\r\nb: 2\r\n").top, { a: 1, b: 2 });
});

test("nothing at all is not an error", () => {
  for (const empty of ["", null, undefined, "\n\n\n", "# only a comment"]) {
    const { top, items, problems } = parse(empty);
    assert.deepEqual(top, {});
    assert.deepEqual(items, []);
    assert.deepEqual(problems, []);
  }
});

// ---- what it refuses to guess at ------------------------------------------

test("a tab indent is reported, with its line number", () => {
  const { problems } = parse(["routines:", "\t- title: One"].join("\n"));
  assert.deepEqual(problems, ["line 2: tab indentation; YAML allows only spaces"]);
});

test("a line that is not a key, a list item or a comment is reported", () => {
  const { problems, top } = parse(["query: org:acme", "this is not yaml"].join("\n"));
  assert.deepEqual(problems, ['line 2: couldn\'t read "this is not yaml"']);
  // The rest of the file still parses: one bad line does not lose the others.
  assert.deepEqual(top, { query: "org:acme" });
});

test("a key written twice is reported, and the second one wins", () => {
  const { top, problems } = parse(["routines:", "  - title: One", "    project: a", "    project: b"].join("\n"));
  assert.deepEqual(problems, ['line 4: "project" appears twice; the second one wins']);
  assert.equal(parse(["routines:", "  - title: One", "    project: a", "    project: b"].join("\n")).items[0].project, "b");
  assert.deepEqual(top, {});
});

test("an indented key belonging to no list item is reported", () => {
  const { problems } = parse(["query: org:acme", "  orphan: value"].join("\n"));
  assert.deepEqual(problems, ['line 2: "orphan" is indented but belongs to no list item']);
});

test("a map item that lost its key arrives as a string, for the panel to reject", () => {
  // `- Review flaky tests` is a routine someone wrote without `title:`. The
  // parser does not know which kind of list this is, so it hands over what it
  // read and routines.js says what is missing from it.
  const { items, problems } = parse(["routines:", "  - Review flaky tests"].join("\n"));
  assert.deepEqual(items, ["Review flaky tests"]);
  assert.deepEqual(problems, []);
});

test("a problem does not stop the parse: every bad line is reported", () => {
  const { problems } = parse(["\tbad tab", "also not yaml", "  orphan: v"].join("\n"));
  assert.equal(problems.length, 3);
  assert.match(problems[0], /^line 1: tab/);
  assert.match(problems[1], /^line 2: couldn't read/);
  assert.match(problems[2], /^line 3: "orphan"/);
});
