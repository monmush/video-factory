# Character voices

Updated 13 November 2026. Owns the voice catalogue, how a character gets its voice, how the voices were chosen and the plan for making voices sound like one room. Code: `src/shared/voices.ts` (catalogue and rules), `src/main/voices.ts` (provider mapping, main process only), voice row in the character dialog.

## Decisions (agreed with the owner)

- **A voice belongs to the character** (library asset), so a recurring character keeps one recognisable voice across videos. It is optional and never blocks anything.
- **No voice chosen: the app assigns one by rule and saves it**, so the choice is made once and not re-guessed per video. The dialog preselects the suggestion while the character is created or edited; generation uses `resolveVoice` for characters saved without one.
- **Staff pick from a short list we chose**, never from a provider library. Voices carry our own Vietnamese names and labels; provider names and voice ids never appear in the UI.
- **No voice settings** (speed, tone, stability). Only which voice.
- **Accent: Northern only for now.** Shown as a read-only choice (Bắc selected, Trung and Nam disabled with "Sắp có") to hint that more will come.
- Minimal text: no helper paragraphs in the voice row.

## Catalogue

Order within each gender is preference order. Ages: bands the voice suits, best fit first (young under 35, middle 35–59, old 60+).

| Id | Name | Gender | Ages | Label |
| --- | --- | --- | --- | --- |
| mai | Mai | female | young | tươi sáng, tự nhiên |
| nhu | Như | female | young | điềm tĩnh, tự tin |
| hanh | Hạnh | female | young | mượt, rõ ràng |
| hien | Hiền | female | middle, old | ấm, trầm |
| trang | Trang | female | middle, old | ấm áp, đáng tin |
| ninh | Ninh | male | young | trầm ấm, gần gũi |
| son | Sơn | male | young | rõ ràng, điềm đạm |
| tuan-anh | Tuấn Anh | male | old, middle | trầm ấm, kể chuyện |
| lam | Lâm | male | middle | ấm, trò chuyện |
| luong | Lượng | male | middle | điềm tĩnh, rõ ràng |

Defaults: `mai` for women, `tuan-anh` for men (the pair the owner approved by ear, after an A/B listening of dialogue with different pairs). Unknown gender: `mai`.

## How a voice is suggested

1. `guessVoiceTraits(name, description)` reads gender and age from Vietnamese text. Strongest first: an age in years ("khoảng 70 tuổi"), then plain words (nam, nữ, đàn ông, phụ nữ, trẻ, trung niên, lớn tuổi, già), then forms of address (ông, bà, cô, chị, anh, chú, bác, cụ). Words are matched whole, so "xanh", "bàn" or "công" never count; common other meanings are excluded (Việt Nam, cô đơn, chú ý, bác sĩ, dụng cụ) and a capitalised word after another is read as part of a name ("Tuấn Anh").
2. `suggestVoice(traits, taken)` picks the same gender, then the voice whose best-fit age matches, in preference order. Voices already saved on other characters are skipped while the gender has a free one; if all old voices are taken, the nearest age comes next. An old woman gets a middle-aged female voice (there is no elderly female voice). A middle-aged man gets Lâm, keeping Tuấn Anh for elderly men.
3. The character description prompt now asks for gender and approximate age in years in its first sentence, so AI-written descriptions feed step 1 reliably.

In the dialog the suggestion follows the name and description until the user picks a voice by hand; after that it is never overridden. Saving stores whatever is shown.

## How the voices were chosen

- Source: the provider's voice library, native Vietnamese, Northern or "standard" (Hanoi) accent, ranked by one-year usage. 198 candidates; the top dozen per gender/age group (53 clips) were measured.
- Each voice's free sample clip was measured, not listened to: speech bandwidth (to exclude phone-quality recordings; several of the most-used voices carry almost nothing above 4–6 kHz), level in the quietest frames (noise and room tail), and how fast the level falls after words (echo).
- Only voices with a long removal notice (365–730 days) were kept, so a voice cannot vanish mid-series.
- Limits: clips are 3–11 seconds, so the numbers are a coarse filter. Only `mai` and `tuan-anh` are approved by ear; the owner is listening to the rest.
- Removed: `ngan`, a library voice the owner recognised as an unauthorised copy of a well-known person's voice (12 Nov). Never add a voice that imitates a recognisable real person; the library's "professional" label does not guarantee consent.
- Gaps: Tuấn Anh is the only elderly male voice, so a second old man gets a middle-aged voice; no elderly female Vietnamese voice exists in the library; no Central or Southern voices chosen yet.

## Sample clips

The clips in `src/renderer/src/assets/voices/` are our own, not the library previews (the owner, 12 Nov: people might recognise the provider's clips). Every voice reads the same brand-neutral line, so they compare fairly and the app needs no change when sold to other businesses:

> Xin chào! Đây là giọng đọc của tôi. Có một câu chuyện nhỏ rất thú vị, bạn có muốn nghe thử không?

Generated 12 Nov with `eleven_v4` text-to-dialogue, one take per voice, prefixed with the same dry close-mic direction as dialogue 03; 333 credits for eleven voices, including the since-removed `ngan`. Levelled to the same loudness (FFmpeg `loudnorm` I=-18, TP=-1.5), mono 128 kbps, about 6 s each. A new voice gets the same line, direction and levelling.

## Sounds without words — 13 November 2026

A line may end with one sound in square brackets when the story calls for it, for example a laugh after one's own joke: `[cười]`, `[cười khẽ]` or `[thở dài]` (`src/shared/cues.ts`). The script writer may use it at most twice per script; anything else in brackets is removed from what the writer returns. The voice step sends the voice model's own tag (`[laughs]`, `[chuckles]`, `[sighs]`, after the dry close-mic direction); subtitles skip it; it is not counted as a word in lengths and prices; the director keeps it on the speaker's shot and holds after it. Untested live: whether `eleven_v4` laughs convincingly in Vietnamese dialogue, and how long the laugh runs. Tags in English are the provider's convention, so a script never shows them.

## Shared acoustics (1–2 built in the voice step; 3 not built)

1. Catalogue voices are chosen dry and close-mic, so any pair is compatible.
2. A whole exchange is generated in one multi-speaker dialogue request, with the same dry-recording direction on every line, as in the approved audition dialogue (kept locally).
3. The room is added once, by us, at assembly: each speaker levelled to the same loudness, then one shared light room reverb and one ambience bed over the whole mix (FFmpeg), matched to the scene.
4. If a voice still sounds wet, remove it from the catalogue rather than repair it per video.

## Open items

- (a) the owner listens to the eight unheard voices and removes any they dislike or recognises as a real person. Measured on the sample line, `luong` has a much louder background and longer tail than the rest (possible room echo); `son` is mildly raised.
- (b) Seven of the ten are not in the ElevenLabs account. Speech generation worked for all of them without adding (12 Nov), so adding is optional; the current key lacks `voices_write` anyway. `src/main/voices.ts` keeps the public owner ids in case it is needed.
- (c) One short paid dialogue audition per new voice against the approved pair, to hear them together. Needs the owner's approval of model, scope and estimate.
- (d) Whether fal's ElevenLabs endpoints accept these voice ids is unverified, so speech may stay on ElevenLabs directly.

