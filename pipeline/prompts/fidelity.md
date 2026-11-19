# Testing how well a student understands

The bank should tell a student who holds an idea from one who has memorised a sentence about it, and say which wrong idea a student holds. `validate.mjs --fidelity` enforces it. `FORMAT.md` (Misconceptions) has the fields.

- **Name the wrong ideas first.** For each concept, list 2 to 4 `misconceptions`: wrong ideas students really bring to it, each said the way a student would say it (`claim`), with what is true instead (`correction`). Prefer the well-known ones, such as "at equilibrium nothing moves", "plants get their mass from the soil", or "a dominant allele is the common one". A misconception is a belief, not a gap: "doesn't know what ATP stands for" is not one.
- **Build wrong choices from them.** A good wrong choice is what a student holding one of those ideas would pick. Say so in `mistakes`: one entry for each choice, `null` for the right choice, the misconception's `id` for a wrong choice that follows from it, and `null` for a wrong choice that is only a slip. Use each misconception in at least 2 items. Never tag a choice with an idea it doesn't follow from: a second model checks every tag without seeing yours, and a tag it doesn't agree with is removed.
- **Ask for use, not recall.** At most 40% of items may be difficulty 1. The rest make the student use the idea:
  - predict: "A red blood cell is put in pure water. What happens to it?"
  - explain: "Why does ...?", with choices that are different explanations
  - tell apart two things students confuse, such as diffusion and osmosis
  - apply the idea to a case the explanation didn't use
  - find the error: "A student says .... What is wrong with that?"
- **One idea at a time.** A question that needs two misconceptions avoided at once can't say which one a student holds.
