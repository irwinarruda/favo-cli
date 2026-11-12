---

name: client-jsx-styleguide
description: Always load when creating or changing OpenTUI React views in apps/client: screens, components, dialogs, keyboard and mouse handling, layout, color and bee theming.
---

# Client JSX styleguide

## Rules

- A screen is a folder with `index.tsx`; private components are siblings. Promote to `shared/components` only when another screen uses it and it has no domain meaning. A view two screens of one module share, with domain meaning, goes in that module's `components/`.
- Select narrowly: `useApp((state) => state.selectedSeat)`. Never the whole store, never `getState()` in a component.
- Handlers are `on{Name}{Event}`. Wrap at the binding site: `onMouseDown={error.handle(onSeatClick)}`.
- Component order: variables, computed values, functions, effects, then a blank line and `return`. No empty lines inside JSX.
- `{condition && <X />}` with a real boolean; a ternary only when both sides render.
- Never put Zustand actions in dependency arrays.
- Everything clickable also has a key, and the key bar shows it. A dialog disables the screen keys.

## Look

- Colors come from the active theme: `const colors = useApp((state) => state.colors);`. Never a literal; the architecture test fails on one. `accent` means active or signed in, `text` is text, `faint` is quiet, `danger` is a problem.
- Inspiration is OpenCode and Claude Code's fullscreen mode: rounded borders, generous empty space, one line of dim key hints.
- The bee theme lives in the glyphs (`⬢` signed in, `⬡` not) and in light words: hive for a machine, cell for an account, walls for shared files. Clarity wins over a pun; an action label stays plain.

## Checklist

1. It works at 80 columns as well as 130.
2. A screen test covers the new key and the click.
