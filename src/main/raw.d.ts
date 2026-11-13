// Text files bundled into the main process (Vite's ?raw import).
declare module "*.md?raw" {
  const text: string;
  export default text;
}
