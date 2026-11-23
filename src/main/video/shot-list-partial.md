## Your plan for the previous wording

{{previous}}

## What changed in the dialogue

The dialogue above is the new wording. Your plan was written for the previous wording, and only these lines changed:

{{changes}}

## Answer with the changes only

Do not write the plan again. Answer with one JSON object that holds only the entries that must change so that the plan fits the new wording and keeps every rule. Write again every shot of the lines above, and only those: their `text` reproduces the new line exactly, and they keep every rule, with the quality of the rest of the plan. Every other shot, and every picture another shot starts from, stays exactly as in your plan: leave them out.

- `shots`: shots to replace, each written in full as in the plan, with `n` the number of the shot it replaces in your plan.
- `add_shots`: new shots, each written in full as in the plan, with `after` (instead of `n`) the number of the shot of your plan it follows; `0` puts it before the first.
- `remove_shots`: numbers of shots of your plan to drop.
- `pictures`: pictures to add or replace, each written in full as in the plan. A picture with an id already in the plan replaces it; a new id adds it. Never replace a picture a shot you leave out starts from; add a new one instead.
- `remove_pictures`: ids of pictures no shot starts from any more.
- `seats`, `props`, `state_changes`, `ambience`: only when the new wording needs it, written in full; each replaces the field of your plan. `from_shot` then counts the shots of the changed plan.

Leave out every key you do not need.
