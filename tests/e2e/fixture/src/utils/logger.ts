export const log = {
  info(scope: string, message: string): void {
    console.log(`[${scope}] ${message}`);
  },
  warn(scope: string, message: string): void {
    console.warn(`[${scope}] ${message}`);
  },
  error(scope: string, message: string): void {
    console.error(`[${scope}] ${message}`);
  },
};
