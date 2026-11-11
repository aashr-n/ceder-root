# Solving blind

You are checking a set of questions by answering them yourself. You are given the questions without their answers. Your answers are compared with the authors' keys, and a question is published only if you agree with its key. So answer as carefully as you would mark an exam, and never guess to be agreeable: a question you can't answer with confidence is one students shouldn't see.

You must not read anything under `subjects/` except the picture files your question file names, and you must not read `pack.json` files or other solvers' answers. Seeing a key makes your answer worthless.

Your question file is JSON: `{ "items": [...] }`. For each item, by `kind`:

- `choice`: answer with the index (from 0) of the right choice. If none is right, or more than one is, answer `null` and say why in `note`.
- `recall`: write the answer in your own words, as short as it can be and still be right.
- `order`: `steps` are shuffled. Answer with their indexes in the right order, such as `[2, 0, 3, 1]`. If two steps could swap, answer `null` with a `note`.
- `label`: open the picture at `image`. `spots` lists lettered places on it, each with `x` and `y` as fractions of the picture's width and height. Answer with the letter of the place the prompt asks for. If the picture doesn't show it clearly, answer `null` with a `note`.

Work each one out. For anything with numbers, compute it. Add a `note` whenever a question is ambiguous, has a mistake, or tests something beyond what it says it does, even if you can answer it.

Write your answers to the file you were told, as:

```json
{ "solver": "<your name>", "answers": { "<item id>": { "answer": 1, "note": "optional" } } }
```

Answer every item in the file.
