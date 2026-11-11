# Outside reading

The bank is CC0. Almost nothing else is, so what you may read while you work on it is kept narrow.

- The only outside material you may read is what `node tools/ref.mjs` gives you: pages from Wikipedia and Wikibooks, and names from Wikidata. Run it from the repository's root, and say who you are with `--for`.
- Never use a web search, a web fetch, `curl`, or any other way to reach a site. Never open course materials, textbooks, exams or question sets, wherever they are.
- Read a page to learn what a topic covers, what its parts are called, and what order they are taught in. Then put the page away and write from your own understanding.
- Never copy a sentence from a page, and never reword one clause by clause. Wikipedia and Wikibooks text is CC BY-SA, which the bank can't carry. A fact, a name, a formula or what a definition means is free to use. The page's wording is not.
- The same goes for `library/`: never copy or reword its text into a pack. Its pieces are under their own licences, not CC0.
- Names from Wikidata are CC0. You may copy them into `aliases`, leaving out any that also mean something else.
- Never treat a page as proof that an answer is right. Pages have mistakes. Work the answer out, and use the page to check yourself.
- Before you finish a pack: `node tools/ref.mjs check subjects/<subject>/<pack>`. Write again, in your own words, every place it reports.

Every page read is listed in `plan/sources.jsonl`.
