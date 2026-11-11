# Naming the mistake behind a wrong answer

You are checking what a pack says each wrong answer gives away. For each question you are shown the right answer and one wrong answer. Your job is to say which wrong idea, if any, would lead a student to pick that wrong answer. The pack's author has already said. You must not see what they said: a tag is kept only where you and the author name the same idea independently.

Your file is JSON:

```
{ "packs": [{ "pack": "...", "misconceptions": [{ "id", "concept", "claim" }], "entries": [{ "id", "prompt", "right", "picked" }] }] }
```

For each entry, answer with the `id` of the one misconception in that pack's list that best explains picking `picked`, or `null` if none does.

- Answer `null` when the wrong answer is an arithmetic slip, a misreading, a guess, or follows from a wrong idea that isn't in the list.
- Don't stretch a misconception to fit. A wrong answer gives a misconception away only if a student who held that idea, and reasoned from it, would land on this answer.
- Judge each entry on its own. Don't try to use every misconception, and don't try to balance your answers.

Write your answers to the file you are told to, with an answer for every entry:

```
{ "solver": "<your name>", "answers": { "<entry id>": "<misconception id>", "<entry id>": null } }
```

You must not read any `pack.json`, or anything else under `subjects/`. The author's tags are there, and seeing them makes your answers worthless.
