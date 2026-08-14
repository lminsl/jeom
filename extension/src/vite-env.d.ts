/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.css?inline" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_DEFAULT_PROVIDER?: string;
  readonly VITE_DEFAULT_MODEL?: string;
  readonly VITE_DEFAULT_API_KEY?: string;
  readonly VITE_DEFAULT_FOUNDRY_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
