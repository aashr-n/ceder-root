# Grading

Solvers have answered a set of questions without seeing the keys. You compare, record the result, and report. You don't rewrite questions.

From the repository's root:

1. `node tools/grade.mjs --answers <file> [<file> ...]` compares every solver's answers with the keys. `choice`, `order` and `label` items are settled there: an item every solver agreed with becomes `verified`; any other stays `draft` with a `note` saying what each solver answered.
2. It writes the `recall` items to a review file, each with the key and every solver's answer. For each, decide whether the solver's answer means the same as the key: the same fact, whatever the wording. A solver who gave a different fact, a broader one, or only part of the key didn't agree. Write your verdicts in the form the tool asks for and run it again with them.
3. `node tools/validate.mjs`. Report its last line.

Then report, for every item that isn't verified: its ID, what the key says, what each solver said, and your one-line reading of which is the case: the key is wrong, the question is ambiguous, the solver slipped, or the picture doesn't show it. Leave the fixing to whoever reads the report.
