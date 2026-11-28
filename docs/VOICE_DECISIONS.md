# Character voices

Updated 28 November 2026. Owns how a character gets its voice, the voice sample the video model hears, and what is still unverified. How a speech clip is requested: [video generation](VIDEO_GENERATION_DECISIONS.md), "The video model speaks". Code: `src/shared/voices.ts` (voice text, default rule, region, migration), `src/shared/voice-step.ts` (the job's voices step), `src/shared/voice-request.ts` (what the voice-making model is asked), `src/main/voice-maker.ts` (the voice-making model), `src/main/voice-upload.ts` (an uploaded voice), `src/main/voice-suggestions.ts`, `src/renderer/src/components/voice-field.tsx`.

## An uploaded voice (28 November 2026)

Asked by the owner 28 November: a character can speak with a real voice instead of the made sample.

- **Data**: `Asset.voiceSample`, the name of a file in `voices/`, `upload-<sha256 of the treated file>.mp3` (`isUploadedSample`). The voice text stays and keeps its role: the writer's accent rules and the dialog's text field. Saving keeps, removes (`null`) or sets it; a name that is not an upload or not on disk is refused ("Không tìm thấy giọng đã tải lên"). Only characters carry it. Sample files are never deleted, also not when an upload is removed or replaced. It travels in setup sharing with the asset and the `voices/` folder.
- **Upload** (`voices:pick-upload`, free, the same in fixture mode): a file picker for audio or video (mp3, wav, m4a, aac, ogg, flac, mp4, mov, m4v, webm). A file without sound: "Tệp này không có âm thanh". It gets the same treatment as a made sample (mono, the first 12 s, −18 LUFS, mp3); shorter than 2 s: "Giọng mẫu cần dài ít nhất 2 giây".
- **Character dialog**, beside "Giọng nói": without an upload the controls above plus "Tải lên", which plays the file once picked. With an upload, "Nghe thử" / "Dừng", "Đổi" and "Gỡ"; the paid "Giữ để nghe" and "Tạo lại" are hidden. "Gỡ" returns to the made sample. An upload whose file is missing shows as none, and is kept unless the user changes it. The text field and suggestions are unchanged.
- **In a video**: a character with an upload on disk gets it as its sample, ready, never made or priced; a missing file falls back to the made sample. A staged video follows an upload added or removed; a started video keeps what it recorded, as for any voice.
- **Speech prompt**: with an uploaded voice the sentence `That voice is described as: "…"` is left out, because the text may be only the guessed default and contradict the recording; the binding to Audio 1 stays.
- **Ready check**: characters with an upload are compared by file, the others by voice text; so the same text with different uploads gives no warning, and one file shared by two characters does.

## Why the voice-making model changed (26 November 2026)

MiniMax Voice Design cost $3 a sample, of which the app used only the preview clip, and on the first live sample it gave a Southern accent for "miền Bắc". On 26 November the owner compared by ear Eleven v4, MiniMax Speech 2.8 HD and Gemini 3.8 Flash TTS; Gemini held the instructed accent. The owner's note: not quite studio quality, accepted.

## Why it changed (25 November 2026)

When the video model speaks, each clip invented a new voice from a fixed English sentence, so a character changed voice and accent between clips. The ten catalogue voices (and their ElevenLabs ids and sample clips) could not cover characters of other regions or nations and are removed, with the separately configured ElevenLabs key. Everything now goes through fal.

## Decisions (agreed with the owner)

- **A character's voice is a text**: `Asset.voice`, free Vietnamese, at most 200 characters (gender, age, region or accent, timbre, pace, attitude). It replaces `voiceId`. Saved characters with a catalogue voice got a text built from its row, for example `mai` → "Giọng nữ trẻ, miền Bắc, tươi sáng, tự nhiên", `tuan-anh` → "Giọng nam lớn tuổi, miền Bắc, trầm ấm, kể chuyện" (`withVoiceTexts`, run when the workspace is read).
- **Every character always has a voice; nothing blocks.** A character saved with an empty voice gets the default in the main process.
- **Default** (`defaultVoiceText`): "Giọng {nữ|nam} {trẻ|trung niên|lớn tuổi}, {region}, {timbre, pace}". Gender and age band come from `guessVoiceTraits` (unknown gender: female; unknown age: middle). Three variants per gender and age band; the first one no other character already uses is taken, so two characters never get the same default. Region: "miền Bắc" unless the name or description names another place first (Huế, Đà Nẵng, xứ Nghệ… → "miền Trung"; Sài Gòn, miền Tây, Cần Thơ… → "miền Nam") or a nationality ("người Hàn Quốc nói tiếng Việt").
- **Character dialog**, row "Giọng nói" under "Mô tả": a two-line field. Until the user types in it or picks a suggestion it shows the default and follows the name and description; after that it never changes by itself; emptying it returns to the default. No region chooser: region and accent are part of the text.
- **Suggestions**: three chips under the field, the same interaction as "Định hướng" (the label on the chip, the full text on hover, one click fills the field). The user's own text AI is asked from the name and description when the dialog opens and about a second after the description stops changing; stale answers are dropped. While waiting, one shimmer line "Đang gợi ý giọng…"; on failure, or when the text AI is not the user's own, nothing. Fixture mode returns the three default variants.
- **Listen**: beside the label. A sample for exactly this text exists → "Nghe thử" / "Dừng". Otherwise the paid hold "Giữ để nghe", then "Đang tạo giọng…", then it plays. A failure shows "Không tạo được giọng" and the hold again. When a sample exists, the paid hold "Tạo lại" beside "Nghe thử" makes a new sample for the same text and replaces the old one (same file); a failure keeps the old one playable. A video already running with that voice uses the new sample for the clips not yet made. The dialog stays usable and saving never needs a sample.
- **Words follow the voice** (writer and series direction): each character is listed with its voice text; the accent for the writing rules is read from that text (`accentOfVoice`: Bắc or Hà Nội → North, Trung, Huế, Đà Nẵng, xứ Nghệ → Central, miền Nam, Sài Gòn, miền Tây → South; anything else gets no accent rule).
- **Ready check**: two characters who speak in the videos with the same voice text (compared trimmed, case-insensitive, spaces collapsed) give the warning "{A, B} cùng giọng" with "Đổi giọng". A warning, never a block.

## The voice sample

- Made by `google/gemini-3.8-flash-tts` through `falCall` (dialog) or the queue (video), purpose `character-voice`, recorded in usage. Input (`voiceRequest`): `prompt` = "Xin chào! Đây là giọng nói của tôi. Hôm nay trời đẹp quá, mình ngồi xuống đây một lát rồi kể cho nhau nghe một câu chuyện nhỏ nhé. Bạn có muốn nghe thử không?" (brand-neutral, about 12 s); `voice` = a base voice; `style_instructions` = English sentences: who and accent ("A young Vietnamese woman, a native speaker with a Northern Vietnamese (Hanoi) accent."; Central: Huế, Southern: Saigon; no region found, for example a foreign speaker: "A young woman speaking Vietnamese with exactly the accent the description names."), then `The voice is described in Vietnamese as: "<voice text>".`, then "Speaking naturally, as in everyday conversation. Clean, dry, close-microphone studio recording with no background sound and no music." The output `audio.url` (WAV) is kept.
- **Gender and age** (`spokenTraits`): what the voice text states (`voiceTextTraits`: lowercase "giọng nam" is a male voice, "giọng Nam" or "miền Nam" the South); for what it leaves out, the character's name and description (`guessVoiceTraits`); then female for gender, and no age named. So a typed "trầm ấm, chậm rãi" on "Ông lão" speaks as an elderly man. The dialog uses its current, possibly unsaved, name and description.
- **Base voice**: Gemini's preset names are split into a female and a male pool from Google's published list; the preset is picked within the gender's pool by a stable hash of the normalised voice text.
- Treated with FFmpeg: mono, at most 12 s (the video models take 2–15 s), −18 LUFS, true peak −1.5, mp3. Shorter than 2 s is a failure.
- **Stored by content**: `<data folder>/voices/<sha256 of the request's identity>.mp3`, the identity being the model id, the preset and the style instructions (`sampleIdentity`). Any change to the model or to how the request is built makes new samples instead of reusing stale ones; earlier samples become unfindable and are made again on demand, and samples are never deleted automatically. Two characters with the same text and the same resolved gender and age share a sample; editing the text, or a character change that the text leaves to the character, points at another file. The dialog's address of a sample carries the file's modification time, so a remade sample is never played from a cached copy.
- Price, list read 26 November 2026: $0.045 per 1000 characters; the preview text's 158 characters make about $0.007 (`VOICE_SAMPLE_USD`). Whether the style instructions' characters are billed too is unmeasured.
- Fixture mode: no network; the fixture dialogue gets the same treatment after a short wait.

## In a video: the voices step

- When a video starts (after the first hold) it records, per character who still has lines to speak, the voice text, the character's gender and age band at that moment and the sample file it uses (the request is rebuilt from these, so later edits never reach it; a video saved before 26 November has no recorded character and is treated as text only), and keeps them: editing a character later changes the next videos, never one already started. Until then a staged video follows the characters (and the price follows which samples exist). Old videos without recorded voices take them on resume.
- Missing samples are made alongside the stills, through the same marks, restart attachment, stop and resume as other paid steps; one automatic retry, then the video fails with the usual "Giữ để tạo tiếp". No speech segment of a character is sent before its sample exists.
- Cost: the group "Giọng nhân vật", listing only samples the video had to make; it is part of the first hold's price. A batch counts a sample shared by several videos once. The progress list shows "Tạo giọng nhân vật" only when something had to be made.

## Not verified

- The Central accent and foreign-speaker texts with the new model (only Northern was heard).
- Whether two characters on the same preset sound distinct enough.
- The gender of presets other than Leda (female) and Charon (male), which were heard.
- Whether Wan 3.0 and MiniMax H3 Max hold the voice and accent from the reference sample across clips (fal does not document what the audio references do).
- Wan 3.0 reference-to-video has no start frame: the still is only a reference, so its first frame may differ from the picture.
- The billed units of the voice-making model and of both reference-to-video endpoints.
- Whether the video models hold an uploaded real voice across clips.
- Only the first 12 s of an uploaded file are used; whether a later part would be a better sample is not judged.

## Sounds without words — 13 November 2026

A line may end with one sound in square brackets when the story calls for it: `[cười]`, `[cười khẽ]` or `[thở dài]` (`src/shared/cues.ts`). The writer may use it at most twice per script. The speech prompt describes it after the quoted words ("then they laugh softly"); subtitles skip it; it is not counted as a word in lengths and prices.
