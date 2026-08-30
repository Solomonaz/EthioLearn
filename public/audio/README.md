# Game audio assets

The teacher games load their audio from this folder. **Everything works without
these files** — short effects fall back to a synthesised Web-Audio tone and the
background music simply stays silent — but dropping real `.mp3` files here makes
the games sound proper. No code changes are needed; the engine picks them up by
filename.

Keep files small and web-optimised (mono, 96–128 kbps is plenty). Loop the music
tracks cleanly (no gap at the seam).

## Sound effects — `public/audio/sfx/`

| File            | When it plays                                   |
| --------------- | ----------------------------------------------- |
| `correct.mp3`   | A right answer / successful match / solved move |
| `wrong.mp3`     | A mistake                                        |
| `click.mp3`     | General UI taps (buttons, direction pad, ticks) |
| `level-win.mp3` | A level / round / match is completed             |

Keep these very short (correct/wrong/click ≈ 100–300 ms).

## Background music — `public/audio/music/`

One loop per game, each with a mood that fits it (they are intentionally
different). Plays on a loop at ~25% volume.

| File             | Game            | Suggested mood                     |
| ---------------- | --------------- | ---------------------------------- |
| `tug.mp3`        | Tug of War      | Energetic, sporty, competitive     |
| `memory.mp3`     | Number Memory   | Calm, focused, gentle              |
| `routing.mp3`    | Routing Robot   | Quirky, playful electronic         |
| `find-color.mp3` | Find the Color  | Light, airy, concentration-friendly |
| `find-pair.mp3`  | Find the Pair   | Curious, upbeat, playful            |
| `picker.mp3`     | Random Picker   | Light game-show / anticipation      |

## Controls

- Global **mute / unmute** lives in the teacher top bar (speaker icon); the
  choice is remembered per device.
- Audio only starts after the first click/tap on the page (browser autoplay
  policy) — this is handled automatically.
