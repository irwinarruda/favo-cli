# Changelog

## [Unreleased]

## [0.14.1] - 2026-11-12

### Fixed

- Tokens, cost and sessions are no longer counted twice when two accounts on one machine can reach the same session log, through a link or a copy of a folder or a thread. A log is now counted once, for the account that holds the real file, and a request or a Codex session that sits in two accounts goes to the one whose file is older. Your totals may go down after this update: on its first count, favo forgets what 0.14.0 stored for the accounts that had the problem and counts them again from their logs. To see if you had it, run `find ~/.favo/accounts/*/claude/projects -type l | wc -l`: anything above zero means one account was counted too high.
- A link in a log folder that leads to a file that is gone is now reported as a record favo could not read.

## [0.14.0] - 2026-11-12

### Added

- See how many tokens every seat used, and what they would cost at API list prices. The Usage screen (`u`) now has three pages, Limits, Tokens and Cost: `l` `t` `c` or `tab` change the page, `1` to `5` or the arrows pick the last 24 hours, 7, 30 or 90 days or all time, and `b` switches the table between models and days. Each page shows the total, the shape of the period, and the split by provider, account, machine and model. It covers Claude Code and Codex.
- `favo usage --tokens` and `favo usage --cost` print the same in the terminal, with `--days <n>` or `--all` for the period. `--json` prints one row per day, machine, account, provider and model, ready for a script or a site.
- Narrow any Usage page to some machines, accounts and providers. Press `f` in the TUI, or pass `--machine`, `--account` and `--provider` to `favo usage`, each as many times as you like.
- favo keeps its own count of tokens by hour in `~/.favo/usage`, because Claude Code deletes its logs after 30 days. It counts once a day when the TUI opens, so a day is not lost on a machine where you rarely open Usage.

### Changed

- `favo usage` takes `--limits` to name the page it always printed. Its output and its `--json` are the same as before.
- For the Cost page, favo downloads LiteLLM's public price table from GitHub, at most once a day and only when you open Tokens or Cost. It is the first network use favo has besides downloading itself.

## [0.13.0] - 2026-11-07

### Changed

- The `smoke` and `veil` themes are less sandy, matching Favo Smoke and Favo Veil in favo-theme 0.3.0: their gray keeps half as much of the honey tint.

## [0.12.0] - 2026-11-06

### Added

- Two new built-in themes, `smoke` and `veil` (light): Honey and Wax on a calm warm gray, matching Favo Smoke and Favo Veil in your editor. Pick them with `t` or `favo theme smoke`.

## [0.11.0] - 2026-11-06

### Added

- The comb notices when a provider CLI is older on one machine than on another. It says so when it opens, and the key bar offers `P update CLIs` until they match.

### Changed

- `P` now updates the provider CLIs on every machine at once, without leaving the comb. The list of CLIs opens, each one spins while it updates and then shows the version it came from, and a toast sums it up. favo updates itself first on a machine that runs an older one. A CLI that is running is left alone, and favo asks at the end whether to update it anyway. Quitting favo does not stop an update, and opening it again follows the update where it is instead of starting a second one.

## [0.10.2] - 2026-11-05

### Fixed

- An Antigravity account no longer shows a red `!` on `settings.json` once `agy` has saved its settings there. `agy` replaces that file on every save, which broke favo's link, so each account now keeps its own `settings.json` and `keybindings.json`. Pick a model or trust a folder once per account; skills, plugins and `.gemini/config` stay shared.

## [0.10.1] - 2026-11-05

### Fixed

- Each Antigravity account now keeps its own Google login on a Mac, Windows or Linux desktop, in `agy` and in the Antigravity app. Before, every account used the one login in the system keychain, so they all signed in as your base account. Sign in once more in each account; your base account keeps its login.

### Changed

- The Antigravity app signs in on its own in each account, apart from that account's `agy`, like the Claude app, and the comb shows its `app` tag.

## [0.10.0] - 2026-11-05

### Added

- `favo app antigravity <account>` and `p` in the comb open the Antigravity app as an account, on macOS and Windows, with that account's conversations. The app signs in through the same login as `agy`, so it needs no sign-in of its own.

### Changed

- An Antigravity cell no longer says its login "may be shared". On a Mac, Windows or Linux desktop, `agy` keeps one Google login in the system keychain for every cell on that computer, and the cell now says so plainly. Over SSH, in WSL and in containers, `agy` keeps the login in each cell, and the cell says nothing.

## [0.9.0] - 2026-11-04

### Added

- After `p` opens the Claude app on a seat that isn't signed in there, the comb watches for your sign-in for three minutes and shows it as soon as it happens, so you no longer need `r`. The cell says it is waiting.

## [0.8.0] - 2026-11-04

### Added

- Claude seats on your other machines show their Claude app's sign-in too, read on that machine over SSH once favo there is updated to this version. `p` still opens the app only on the computer you are at.

### Changed

- The Claude app's sign-in is a small `app` tag at the end of the seat's row instead of `app ⬢`: filled in honey when the app is signed in, red when it is on another account than Claude Code, plain when it is signed out, and `app?` when favo can't tell.

### Fixed

- A Claude seat with a long email no longer breaks its row onto two lines or squeezes its `⬢` against the name. Only the email is cut.
- A cell too tall for the terminal cuts its last lines instead of dropping lines from the middle, such as the email or the `LAST THREAD` heading.

## [0.7.0] - 2026-11-04

### Added

- The comb now shows whether each seat's Claude app is signed in, apart from its Claude Code, because the two sign in separately. A local Claude seat shows `app ⬢` when the app is signed in, `app ⬡` when it is not, and `app ?` when favo can't tell, as from the first time favo opens the app until you sign in there. The cell says so in words. When the app and Claude Code are signed in to different accounts, the comb marks it in red: the app's Code tab then spends the app's account. ChatGPT signs in through the seat's Codex, so it needs nothing new.
- `favo app claude <account>` says when that seat's Claude Code is signed out, and how to sign it in, since signing in to the app does not sign in Claude Code.

## [0.6.0] - 2026-11-04

### Added

- Press `v` in the comb to see every provider CLI on every machine: its version and how it was installed. A version older than on another machine is marked, so machines that drifted apart stand out. When an update did not go through, it says why: still updating, failed with its exit code, stopped, or left alone because it is pinned, turned off or running. An update that worked leaves nothing behind. After `P`, the comb opens this list. favo reads the versions from the binaries in the background, and checks nothing online.

### Changed

- `favo update` now updates only favo, here and on every machine. `favo update --providers` updates the provider CLIs too, as `favo update` did before.
- Every command that names a seat now takes the provider first, the way starting one always did: `favo resume claude work`, `favo login claude work`, `favo app claude work`, and the same for `logout`, `threads`, `path`, `inspect` and `adopt`. When favo starts a provider, favo's own options such as `--dir` and `--machine` (`-m`) go before it: `favo -m devbox claude work`. Written after the account, they now go to the provider, so `favo codex work -m devbox` asks Codex for a model called devbox.
- A machine on an older favo now shows as outdated, with no accounts, until you update it, because the two versions no longer read each other's commands. `favo update` updates them all.
- A Herdr pane saved by an older favo shows an error when Herdr restarts, instead of going back to its thread. Start that seat again by hand, and Herdr brings it back from then on.

### Fixed

- Options and prompts after the account now reach the provider without `--`: `favo claude work --chrome` runs `claude --chrome` as work, and `favo claude work "fix the bug"` no longer drops the prompt. `--` still works.
- `favo update` on a Homebrew install now finds a new favo the day it is released, and `--providers` does the same for provider CLIs from Homebrew. Homebrew skips refreshing a tap for up to a day before an upgrade, so favo has it refresh first, as `brew update` does.

## [0.5.0] - 2026-11-02

### Added

- `favo update` now updates everything in one command: favo on this computer through Homebrew or npm, favo on your other machines, then Claude Code, Codex, OpenCode and Antigravity CLI on each one. It shows each provider's version and how it was installed before changing anything, and reports each result. If favo cannot update on this computer, it stops there and leaves your other machines alone. `favo update --machine <machine>` does one machine, and `local` means this computer. In the comb, press `P` to update the provider CLIs of the selected machine.
- `favo update` never touches a provider that is running through favo without asking first. It also leaves a provider alone if you turned its updates off or pinned it in Homebrew, and tells you why.

### Changed

- `favo machine update` now names the machines it skipped because it could not reach them.

### Fixed

- Updating favo on a machine no longer adds provider hooks to it. Hooks that are already there stay current, even if the computer you run the update from has none.

## [0.4.0] - 2026-11-01

### Added

- See how much limit every seat has left and when it comes back, on every machine, in one screen. Press `u` in the comb, or run `favo usage`, which also takes `--machine <machine>` and `--json`. favo reads every machine once when the TUI opens, so the numbers are ready when you press `u`. It covers Claude Code and Codex, and reads them through their own commands. OpenCode and Antigravity show no limits for now, because favo never reads a token.
- favo can now keep your place. Closing a provider no longer loses the thread: press `b` on a seat, or run `favo resume work claude`, to go back to it in its own folder. Anything after `--` goes to the provider, as it does on a launch. `favo threads work claude` lists what a seat kept, and two sessions in one folder are both kept.
- To know which thread you are in, favo adds a small hook to your provider config, but only once you ask: run `favo hooks install`, or say yes when you press `b`. Your own hooks stay as they are, `favo hooks status` shows where things stand, `favo hooks uninstall` takes it out, and `favo sync` keeps it current. Codex asks each seat once to trust the hook. Without the hook, favo falls back to what Codex and OpenCode list themselves, and says that this is a guess.
- Restarting Herdr now brings a favo seat back on the right account. Claude Code and Codex reopen in the same thread, as the same cell, instead of landing in your personal account. This covers seats on this machine; a seat on another machine does not come back yet.

## [0.3.0] - 2026-11-01

### Added

- Open the Claude or ChatGPT desktop app as any account. Press `p` on a seat, or run `favo app work claude`. Each account keeps its own login in the app, and favo only offers this when the app is installed on the computer you are at. If the app is already open, favo asks before closing it; `favo app work claude --close` skips the question.

## [0.2.0] - 2026-10-31

### Added

- favo now notices when another machine runs an older version. It shows `older favo` and the version on that machine, and the machine keeps working until you update it.
- Press `U` to update favo on every machine at once, or `i` on one machine. From the command line, `favo machine update` does the same for every machine, and `favo list` and `favo machine list` show which ones are behind.

## [0.1.2] - 2026-10-31

### Fixed

- The loading message in the add machine, add account and rename dialogs no longer runs into the `esc cancel` hint.

## [0.1.1] - 2026-10-31

### Added

- Install with Homebrew: `brew install irwinarruda/tap/favo-cli`. Every release updates the formula.

### Changed

- The repository is now `irwinarruda/favo-cli`, matching the npm package and the Homebrew formula. The old address redirects.
- The README is now a landing page, with the new logo.

## [0.1.0] - 2026-10-31

### Added

- First release. Run Claude Code, Codex, Antigravity CLI and OpenCode under as many accounts as you have, at the same time, sharing your `CLAUDE.md`, skills and settings.
- Add other machines over ssh or Tailscale. favo installs itself there, and every action works on them.
- A TUI that shows every machine, account and login, plus a command for everything it does.
- Native on macOS, Linux and Windows, installed with `npm install --global favo-cli`.

[Unreleased]: https://github.com/irwinarruda/favo-cli/compare/v0.14.1...HEAD
[0.14.1]: https://github.com/irwinarruda/favo-cli/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/irwinarruda/favo-cli/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/irwinarruda/favo-cli/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/irwinarruda/favo-cli/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/irwinarruda/favo-cli/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/irwinarruda/favo-cli/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/irwinarruda/favo-cli/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/irwinarruda/favo-cli/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/irwinarruda/favo-cli/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/irwinarruda/favo-cli/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/irwinarruda/favo-cli/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/irwinarruda/favo-cli/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/irwinarruda/favo-cli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/irwinarruda/favo-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/irwinarruda/favo-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/irwinarruda/favo-cli/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/irwinarruda/favo-cli/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/irwinarruda/favo-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/irwinarruda/favo-cli/releases/tag/v0.1.0
