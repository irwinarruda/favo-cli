---

name: readme-screenshots
description: Use when a README image is stale, a change alters what the TUI shows, or the request is to retake, refresh, regenerate or add a screenshot, a print or a picture of favo. Also use when the request only says "update the images" or "show this feature in the README". Not for the logos in docs/assets, which are copies of irwin-ui's brand/favo and are never edited here.
---

# README screenshots

Every picture of the TUI in the README comes from one command, so they all look the same and any of them can be retaken.

```sh
bun run screenshots                # every scene, into docs/assets
bun run screenshots favo-remote    # just one
bun run dev:mock favo-remote       # look at a scene by hand, in any terminal
FAVO_SCREENSHOTS_DIR=/tmp/try bun run screenshots   # try it without touching docs/assets
```

Each scene reports `changed` or `unchanged`, and only a changed picture is written, so `git status docs/assets` lists exactly the pictures that changed. If a picture you did not expect is listed, find out why before committing it. macOS moves the title text by a shade between runs, so the comparison is on pixels, with a small tolerance, not on bytes.

## How it works

`apps/client/src/__tests__/scenes.ts` is the table of pictures: each scene names its theme, the keys to press, and any change to the demo data. The scene name is the file name in `docs/assets`.

`bun run dev:mock <scene>` starts favo on `mockDb`, swaps in the demo data, and plays the keys through the renderer's real input. `scripts/screenshots.ts` opens that in a private Ghostty and shoots the window. A launch is the one thing that reliably takes focus, and only a launch through `open`: Ghostty's binary started directly stays behind whichever app is in front. `scripts/screenshot-tools.swift` checks the red traffic light in each shot, and a grey one means closing that Ghostty and launching a new one. The script then fails if the image is out of proportion, and replaces the picture only if it changed.

The demo data is not `mockDb`'s seed: tests depend on that seed, so the showcase lives in `scenes.ts` and never changes `db.ts`.

## The standard

These live in `StandardConfig` and `ScaleConfig` in `scripts/screenshots.ts`, and were measured from the first set of pictures. Change them only to change every picture at once.

| What                | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Image               | PNG of the window alone, no shadow, transparent corners, in the 2240:1572 proportion  |
| Size                | 2240×1572 on a Retina screen, 1177×832 on a 1x one                                    |
| Terminal            | 129 columns by 36 rows (on Retina, `window-width=128` is what yields 129)             |
| Font                | FiraCode Nerd Font Mono Med, 14pt, cell height +20% on Retina and +30% on a 1x screen |
| Padding             | 8pt across, 4pt down                                                                  |
| Chrome              | Ghostty defaults, title `favo`, focused traffic lights, no cursor                     |
| Background          | The theme on screen, so the title bar matches the app                                 |
| Your Ghostty config | Ignored, by `--config-default-files=false`                                            |

The size follows the screen; the proportion does not. On a 1x screen Ghostty rounds each cell to whole pixels, 9×20 instead of 8.5×20.5 points, which makes the picture wider and shorter, so the taller cells and the extra column bring it back within 1% of the proportion. A Retina screen gives sharper pictures, so prefer one when you can.

Demo data: four machines (macbook, devbox, studio, pi offline), six accounts, twelve logins, all under `bee@`. Keep it fictional.

## Add a picture

1. Add a scene to `Scenes`. Use existing names and keys; reach for `stage()` only when the demo data has to differ, as `favo-update` does.

   ```ts
   'favo-help': { themeId: 'honey', keys: ['?'] },
   ```

2. Run `bun run dev:mock favo-help` to check the keys land on the right screen.
3. Run `bun run screenshots favo-help`, and read the image.
4. Add it to the README at `width="760"`, with alt text that describes what the picture shows. The hero is `width="900"`, with `#gh-dark-mode-only` and `#gh-light-mode-only` variants.

A theme preview needs `previewThemeId`, or Ghostty's title bar keeps the saved theme's color. See `favo-themes`.

## A picture of a command

A command's output is a picture too. `CommandScenes` in `scripts/screenshots.ts` maps a name to the arguments, and `scripts/cli-scene.ts` runs the real `favo` with them in the same Ghostty, on a temporary home that `scripts/usage-fixture.ts` fills with made-up session logs. Nothing is read from your own home. See `favo-usage-tokens-cli`.

## Before you say it is done

Read each changed image, and check:

- The screen is the one you meant. A renamed key does not fail a scene; it lands on the wrong screen, or does nothing.
- The README's words and alt text still match the picture. They say four machines and six accounts.

## Requirements

macOS, Ghostty in `/Applications`, Xcode Command Line Tools for `swift`, FiraCode Nerd Font (`brew install --cask font-fira-code-nerd-font`), and Screen Recording access for the terminal you run it from.

A full run opens one window per scene and takes over the screen for about 30 seconds. Warn whoever is at the computer, run it once, and never loop it. Anything typed or clicked during a run lands in the window and can change the shot, which shows up as an unexpected `changed`.

A Ghostty or macOS update can change the window chrome, and every picture with it, and so does a run on a screen of a different scale than the last one. When that happens, retake all of them in one commit so the set stays the same.
