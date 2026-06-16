export const logger = {
  info(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.log(`[info] ${message}`);
    } else {
      console.log(`[info] ${message}`, meta);
    }
  },
  warn(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.warn(`[warn] ${message}`);
    } else {
      console.warn(`[warn] ${message}`, meta);
    }
  },
  error(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.error(`[error] ${message}`);
    } else {
      console.error(`[error] ${message}`, meta);
    }
  }
};
