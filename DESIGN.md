---
version: alpha
name: Pramaan app
description: An editable starting point. Tailwind v4; optional theme export from this file.
colors:
  bg: "#f7f7f5"
  surface: "#ffffff"
  fg: "#1c1c1a"
  muted: "#5f5f5a"
  line: "#d9d9d4"
  accent: "#2f5bd3"
  accent-fg: "#ffffff"
  danger: "#b42318"
typography:
  sans:
    fontFamily: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
    fontSize: 1rem
    fontWeight: 400
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
    fontSize: 1rem
    fontWeight: 400
  title:
    fontFamily: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
    fontSize: 1.5rem
    fontWeight: 600
  label:
    fontFamily: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
    fontSize: 1rem
    fontWeight: 500
rounded:
  lg: 0.5rem
  xl: 0.75rem
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: 0.75rem 1rem
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    borderColor: "{colors.line}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: 0.75rem 1rem
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    borderColor: "{colors.line}"
    rounded: "{rounded.lg}"
    padding: 0.75rem
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    borderColor: "{colors.line}"
    rounded: "{rounded.xl}"
    padding: 1rem
---

# Design starting point

Adapt this design to the founder's app and requested look. Colours, fonts, shapes,
components and layout are editable; the tokens above are conveniences.

`app/theme.css` is app code. Ordinary checks do not regenerate it. To start again
from these tokens, explicitly run `pnpm theme`; review its changes before keeping
it. Other CSS frameworks, raw CSS values, inline styles and self-hosted fonts are
valid choices. Keep readable contrast, usable controls and clear focus states.

Choose layout and visual hierarchy for the content. Check the result on a phone
and a desktop, including loading, empty and error states that the app needs.
