declare module "*.md?raw" {
  const text: string;
  export default text;
}

declare const __BUNDLED_KEYS__: Partial<Record<string, string>>;
