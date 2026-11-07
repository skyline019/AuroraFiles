/// <reference types="vite/client" />

declare module '@aurora-app' {
  import type { ComponentType } from 'react';
  const App: ComponentType;
  export default App;
}

declare module '*auroraFileUrl.mjs' {
  export function mimeFromPath(filePath: string): string;
  export function toAuroraFileUrl(absPath: string): string;
  export function fromAuroraFileUrl(url: string): string;
}

declare module '*vite.config.mjs' {
  import type { UserConfigExport } from 'vite';
  const config: UserConfigExport;
  export default config;
}
