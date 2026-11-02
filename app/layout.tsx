import type { ReactNode } from "react";
import { Shell } from "./shell";
import { siteName } from "./site";
import { styleCandidates } from "./style-candidates";
import { StyleSwitcher } from "./style-switcher";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "@fontsource-variable/lora";
import "./theme.css";

// Platform-owned (pramaan.template.json protectedPaths): the theme and the fonts must load on every page, so the
// agent cannot drop them. The navigation and the page frame are the app's own, in app/shell.tsx.

// Pramaan's preview build sets this; a live build never does, so the switcher is absent there.
const stylePreview = process.env.PRAMAAN_STYLE_PREVIEW === "1" && styleCandidates.names.length > 1;

export const metadata = { title: siteName };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Shell>{children}</Shell>
        {stylePreview && <StyleSwitcher {...styleCandidates} />}
      </body>
    </html>
  );
}
