/**
 * Electron cold entry stays a thin dynamic import so the HTML splash can paint
 * under `<script type="module" async>` without delaying DOMContentLoaded.
 * Web builds use the same path; viteSingleFile inlines everything.
 */
void import("./bootApp.tsx");
