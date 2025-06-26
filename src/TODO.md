- sliders for numbers
- GLSL blocks
- access to the past
- more filters
- autocomplete for ops, hints for args, etc.
- block editor

plan:

- filters are stateful, so we can make "delay"
  - easiest approach here is "if program changes, recreate everything from scratch", so let's do that for now
  - (next level would be reconciliation of some sort)
- input to an op is a stack, so we can do multi-arg ops
- EITHER: we clone things that aren't operated on (/ duped), so we don't worry about "only one video per location", or we have "pointers" (first sounds easier for now)
- no fancy code-mirror stuff for now, do it shellvis-style
