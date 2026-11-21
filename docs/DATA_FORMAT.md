# Lyric Writer: data and interop contract (schema v1)

Every app lives under `andromedajolan.github.io/<repo>/`, so all apps share one browser origin (storage is shared; service workers and caches are not). Each app owns its own prefix and never touches another's.

## Names this app owns
| Kind | Name |
|---|---|
| IndexedDB database | `lyricwriter-db` (stores: `songs` keyed by `id`, `history` snapshots) |
| localStorage | `lyricwriter.pending` (crash mirror), `lyricwriter.last`, `lyricwriter.groupBy`, `lyricwriter.voices` (your list of Suno voices) |
| Cache Storage | `lyricwriter-cache-<version>` |
| Manifest | `id` `./`, `start_url` `./`, `scope` `./` (own path only) |

**Shared on purpose:** `localStorage["studio.theme"]` = `dark` | `gray` | `light`. Any studio app may read and write it.

Other apps should read songs through the JSON backup/export (stage 4) or by opening `lyricwriter-db` read-only. They must never write to it.

## Song object
```json
{
  "v": 1,
  "id": "songmhq3k2ab9x1",
  "title": "Still Talk to You",
  "key": "Bb",
  "mode": "major",
  "bpm": 68,
  "timeSig": "4/4",
  "release": { "type": "album", "name": "Still Here", "date": "2026-11-13" },
  "sections": [
    { "id": "secabc", "type": "Verse", "label": "", "tags": ["piano", "legato", "sparse"], "fade": false,
      "lyrics": "[Bb]I still talk to you when I'm [Gm]alone" },
    { "id": "secdef", "type": "Chorus", "label": "", "tags": ["forte", "crescendo", "legato"], "fade": true,
      "lyrics": "'Cause I still talk to you" }
  ],
  "notes": { "meaning": "", "performance": "" },
  "suno": {
    "style": "pop-punk, emo, Bb major, 68 BPM, legato clean melodic vocal",
    "exclude": "pop production, EDM, autotune",
    "voice": "Andromeda Dunn",
    "weirdness": 20, "styleInfluence": 90, "audioInfluence": null, "audioUploaded": false
  },
  "created": 1763500000000,
  "updated": 1763500000000,
  "deleted": false
}
```
- `id` is stable for the life of the song. Other apps link to a song by this id.
- `key`: C, C#, Db, D, D#, Eb, E, F, F#, Gb, G, G#, Ab, A, A#, Bb, B, or "". `mode`: major, minor, dorian, phrygian, lydian, mixolydian, locrian, or "".
- `release.type`: `none` | `album` | `single` | `pool`; `name` is used for album and pool.
- `release.date`: optional, `YYYY-MM-DD` (calendar date, no time zone), `""` when unset. A song with a date shows a "Final" badge. Added after 0.5.0 without a schema bump: files without it restore as `""`, and older readers ignore it.
- `sections[].type`: Intro, Verse, Pre-Chorus, Chorus, Post-Chorus, Bridge, Hook, Refrain, Interlude, Instrumental, Outro, Other. `label` is an optional custom name; displayed names auto-number repeats (Verse 1, Verse 2).
- `lyrics` is plain text. Chords are inline brackets, `[C]word`. A bracket counts as a chord only if it parses as one (root A-G, optional #/b, quality/extensions, optional /bass); any other bracketed text is left alone.
- `tags`: Suno dynamics/feel tags for the section, without brackets (e.g. `mezzo-forte`, `driving`, `mp`). Always an array; a new section has `[]`. There are no per-type defaults. `fade: true` puts `[diminuendo]` before the section's last line when exporting for Suno.
- `suno.style` / `suno.exclude` are the style block (Suno limit 1,000 characters) and exclude-styles text. `suno.voice` is the name of the Suno voice picked for the song ("" = none); the list of voice names lives in `lyricwriter.voices`, not in the song. `weirdness`, `styleInfluence`, `audioInfluence` are reference values, integers 0-100 or `null` (unset). They are never sent anywhere. `audioUploaded` says whether Audio Influence applies.
- Timestamps are epoch milliseconds. Unknown fields must be preserved by readers.

## Versioning
`v` only changes for breaking changes. Optional additions keep `v: 1`; readers must treat missing fields as unset.
- 0.3.0: `sections[].tags` is always an array (v0.2.0's `null`, meaning "use defaults", now reads as `[]`; per-type defaults and the fixed glossary were removed). Added `suno.voice`. Files from 0.2.0 load unchanged.
- 0.2.0: added `sections[].tags`, `sections[].fade`, `suno.exclude`, `suno.weirdness`, `suno.styleInfluence`, `suno.audioInfluence`, `suno.audioUploaded`. Replaced the v0.1 free-text `sections[].sunoTag` (its bracketed tags are migrated into `tags` on load).

## Suno export rules (what "Copy tagged lyrics" produces)
Per section: `[Header]`, then one line of that section's tags (e.g. `[mezzo-forte][driving]`) if it has any, then the lyrics with chord brackets removed. Verses are numbered (`[Verse 1]`), other types are not (`[Pre-Chorus]`, `[Chorus]`, `[Bridge]`); a custom `label` replaces the header. Sections with no lyrics are skipped. With `fade`, `[diminuendo]` goes on its own line before the last lyric line. Intro/Outro get no special tags. The whole tagged text should stay under Suno's 5,000-character lyrics limit. Instrument words used as tags (piano, guitar, strings...) trigger a warning, because Suno may play the instrument instead of changing the dynamics.

## Planned (not built yet)
JSON backup/restore (will include the tag glossary and defaults) (`{ "format": "lyricwriter-backup", "v": 1, "songs": [...] }`), launcher-friendly manifest (already clean).

## 0.4.0 (rhymes)
No song JSON change (schema stays v1). New localStorage key: `lyricwriter.rhymeOpts` (panel filters).
Dictionary: `data/cmudict.txt.gz`, built by `tools/build_dict.py` from CMUdict + SCOWL. Tab-separated: word, tier (1-8 SCOWL level, 9 = not in SCOWL), 1-3 pronunciation codes (one char per phoneme).

## 0.5.0 (backup file)
Song schema unchanged (v1). Backup file:
`{ "format": "lyricwriter-backup", "v": 1, "exported": ISO date, "app": "lyricwriter 0.5.0", "voices": [..], "songs": [song, ...] }`
Restore also accepts a bare array of songs or a single song object. Same id: newer `updated` wins. New localStorage key: `lyricwriter.lastBackup` (timestamp).
Text import header fields: Title/Song, Key, BPM/Tempo, Time/Time Signature/Meter, Album, Single, Release.
