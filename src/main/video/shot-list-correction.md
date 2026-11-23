## Your previous plan

{{previous}}

## It broke these rules

{{problems}}

## Answer with a correction only

Do not write the plan again. Answer with one JSON object that holds only the entries that must change so that every rule above is kept. Everything you leave out stays exactly as in your previous plan, so change nothing a rule does not require, and keep the quality of what you change as high as the rest of the plan.

- `pictures`: pictures to add or replace, each written in full as in the plan. A picture with an id already in the plan replaces it; a new id adds it.
- `remove_pictures`: ids of pictures to drop.
- `shots`: shots to replace, each written in full as in the plan, with `n` the number of the shot it replaces in your previous plan.
- `add_shots`: new shots, each written in full as in the plan, with `after` (instead of `n`) the number of the shot of your previous plan it follows; `0` puts it before the first.
- `remove_shots`: numbers of shots of your previous plan to drop.
- `seats`, `props`, `state_changes`, `ambience`: only when a broken rule concerns them, written in full; each replaces the field of your previous plan. `from_shot` then counts the shots of the corrected plan.

Leave out every key you do not need. For example, a shot that names a picture that does not exist is fixed by adding that picture:

```json
{
  "pictures": [
    {
      "id": "…",
      "kind": "character",
      "character": "…",
      "people": ["…"],
      "framing": "…",
      "description": "…"
    }
  ]
}
```
