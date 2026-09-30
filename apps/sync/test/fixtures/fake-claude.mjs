#!/usr/bin/env node
// Stand-in for `claude -p` in tests. Records each call to
// $FAKE_CLAUDE_DIR/calls.jsonl and follows $FAKE_CLAUDE_DIR/script.json, one
// entry per call:
//   {edits: [{path, content} | {path, replace: [from, to]}],   // relative to cwd
//    result: "ok" | "limit" | "error" | "max_turns",
//    report: {...partial report}, text: "..."}
import * as fs from 'node:fs';
import * as path from 'node:path';

const dir = process.env.FAKE_CLAUDE_DIR;
const stdin = fs.readFileSync(0, 'utf8');
const args = process.argv.slice(2);
const callsFile = path.join(dir, 'calls.jsonl');
const index = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length : 0;
fs.appendFileSync(callsFile, JSON.stringify({args, stdin, cwd: process.cwd()}) + '\n');

const script = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8'));
const step = script[index] ?? {result: 'error', text: `script.json içinde ${index}. çağrı yok`};

for (const edit of step.edits ?? []) {
  const file = path.join(process.cwd(), edit.path);
  if (edit.replace) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(edit.replace[0])) throw new Error(`${edit.path} içinde yok: ${edit.replace[0]}`);
    fs.writeFileSync(file, text.replace(edit.replace[0], edit.replace[1]));
  } else {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, edit.content);
  }
}

const session = `session-${index}`;
const empty = {updated: [], created: [], retired: [], no_change: [], value_changes: [], findings: [], open_questions: []};
if (step.result === 'limit') {
  process.stdout.write(JSON.stringify({type: 'result', subtype: 'success', is_error: true, result: step.text ?? "You've hit your session limit · resets 3pm", session_id: session}));
  process.exit(1);
}
if (step.result === 'error' || step.result === 'max_turns') {
  process.stdout.write(JSON.stringify({type: 'result', subtype: step.result === 'max_turns' ? 'error_max_turns' : 'error_during_execution', is_error: true, result: step.text ?? 'bir şey ters gitti', session_id: session}));
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'tamam',
  session_id: session,
  total_cost_usd: 0.5,
  num_turns: 7,
  structured_output: {...empty, ...step.report},
}));
