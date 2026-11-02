"use client";

import { useState } from "react";
import type { styleCandidates } from "./style-candidates";

// Preview only (the layout renders it when PRAMAAN_STYLE_PREVIEW=1 at build time). Each candidate is
// a set of theme variables; choosing one sets them on <html>, so the page restyles with no rebuild.
export function StyleSwitcher({ names, vars }: typeof styleCandidates) {
  const [current, setCurrent] = useState("");
  function choose(name: string) {
    const root = document.documentElement;
    for (const set of Object.values(vars)) {
      for (const key of Object.keys(set)) root.style.removeProperty(key);
    }
    for (const [key, value] of Object.entries(vars[name] ?? {})) root.style.setProperty(key, value);
    root.dataset.style = name;
    setCurrent(name);
  }
  return (
    <label className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-lg border border-line bg-surface p-2 text-fg text-sm">
      Style
      <select
        value={current}
        onChange={(event) => choose(event.target.value)}
        className="rounded-lg border border-line bg-surface px-2 py-1"
      >
        <option value="">As built</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
