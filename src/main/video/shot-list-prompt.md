## Pictures and routes: you also say what each shot starts from

Besides the shot plan above, you list the pictures the video needs and say, for each shot, which picture it starts from and how it comes alive. You never choose a model and never write a request: the app's code turns your descriptions into requests, attaches the reference photos and adds the standard sentences about identity and text. Write only what is in the picture.

### This video

- Quality level: **{{level_label}}**. {{level_preference}}
- Refer to every person by their name exactly as in the cast, in every description.

### The operator's direction

The person making this video may have said how some moments should look, in their own words (Vietnamese). Follow each one exactly, at the words it names, unless it breaks a rule above; if it does, come as close as the rules allow. Keep everything else as you would plan it.

{{direction}}

### Pictures

Pictures are the stills every shot starts from. List them in the order they must be made.

- One `master`, first: the whole place with the whole cast seated as the seats say. Every other picture is drawn from it, so seats, light, props and backgrounds agree.
- `character`: one person, composed full size for its framing (never a crop of the master). Over-the-shoulder and varied angles are welcome; eyelines stay as the seats say. Make one picture per person and framing you use, and reuse it for every shot with that person and framing. A picture a `speak` shot starts from shows the mouth closed and the hands away from the face.
- `action`: an object, hands or an action, close; people may be in frame.
- `plate`: for a product shot only, the empty spot where the product will stand. The product's own photo is placed onto it by the app.
- Products and their packaging never appear in any picture or description.

For each picture write a `description`: three to six English sentences, concrete and physical, in this order: the shot size and camera angle; who is where and what they are doing, with posture and expression; what is behind them (from the seats) and which props are in frame, where; the light. Describe one moment. Do not write "keep identical to the photos", "no text" or anything about image numbers: the app adds those.

`people` lists every cast member visible in the picture, the main person first; a shoulder or hand in the foreground counts. The app attaches those people's reference photos.

### Routes (one per shot)

| route        | for                          | what happens                                                                                   |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `speak`      | every `speaker` shot         | the picture comes alive speaking the shot's words, in the app's own voice, with a still camera |
| `motion`     | `wide`, `detail`, `listener` | the picture is animated without speech: one action and gentle camera movement                  |
| `still-move` | `wide`, `detail`, `listener` | the picture with a slow push-in; nothing in it moves                                           |
| `product`    | a product `detail` shot only | the product's own photo placed on its `plate` picture                                          |

{{motion_rule}}

For every shot write `brief`: what the viewer sees during it, for the person making the video, in Vietnamese, one or two plain sentences of 10 to 30 words. Say who is on screen and where they look, what they do with their hands and body, their expression, and what else is in view (the tea, the table, the courtyard), as a moment someone can picture: "Cô gái ôm bụng, nhăn mặt nhìn sang ông lão; sau lưng là khóm trúc." or "Tay ông lão nghiêng ấm đất, trà vàng nhạt rót đầy chén sứ trên chiếu tre." Use the cast names. Do not name the shot size or the camera (the app shows those): no "cận", "toàn cảnh", "máy quay", no English, no film jargon. When the operator's direction names this shot's words, the brief describes what they asked for.

For a `motion` shot write `motion`: one or two English sentences saying only what moves (the one action of the shot, anything stirring gently in the background, the camera movement). For a `speak` or `listener` shot you may write `motion` as one short clause of how the person behaves while speaking or listening; otherwise null.

## Output

Answer with one JSON object and nothing else.

```json
{
  "seats": [
    { "character": "name exactly as in the cast", "behind": "English", "ambient": "English clause" }
  ],
  "props": [{ "name": "English", "where": "English" }],
  "state_changes": [{ "from_shot": 4, "change": "English" }],
  "pictures": [
    {
      "id": "short id, e.g. master",
      "kind": "master | character | action | plate",
      "character": "for a character picture, the name exactly as in the cast; otherwise null",
      "people": ["names exactly as in the cast, main person first; empty when nobody is in frame"],
      "framing": "English: shot size, angle, over-the-shoulder or not",
      "description": "English, three to six sentences"
    }
  ],
  "shots": [
    {
      "n": 1,
      "type": "speaker | listener | wide | detail",
      "character": "for speaker and listener; otherwise null",
      "framing": "medium_close | close, for speaker and listener; otherwise null",
      "line": 1,
      "text": "exact words from that line heard during this shot",
      "seconds": 2.7,
      "visual": "English",
      "product": "for a product detail shot, its name exactly as listed; otherwise null",
      "hold": "1 to 2, only on a shot that ends its line; otherwise null",
      "why": "short",
      "brief": "Vietnamese, 10 to 30 words: who is on screen, what they do, their expression, what else is in view",
      "picture": "id of the picture it starts from (the plate for a product shot)",
      "route": "speak | motion | still-move | product",
      "motion": "English, or null"
    }
  ]
}
```

Before answering, check every rule of the shot plan above, and that: the master is the first picture; every shot has its Vietnamese `brief`; every direction from the operator is followed at its words; every shot names a picture that exists; every `speaker` shot uses `speak` and starts from a `character` picture of that speaker; a product shot uses `product` and a `plate`; every `motion` shot has its `motion` text; every description names people only by their cast names; no product or packaging appears in any picture, description or motion text.
