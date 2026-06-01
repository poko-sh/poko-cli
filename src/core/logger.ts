import pc from "picocolors";

export type Logger = {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  plain(message: string): void;
};

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export const createLogger = (): Logger => ({
  info(message) {
    console.log(`${pc.cyan("poko")} ${message}`);
  },
  success(message) {
    console.log(`${pc.green("poko")} ${pc.green("✓")} ${message}`);
  },
  warn(message) {
    console.warn(`${pc.yellow("poko")} ${pc.yellow("!")} ${message}`);
  },
  error(message) {
    console.error(`${pc.red("poko")} ${pc.red("x")} ${message}`);
  },
  plain(message) {
    console.log(message);
  },
});

export const createPrivateDisplayLogger = (logger: Logger): Logger => ({
  info(message) {
    logger.info(redactPersonalInfo(message));
  },
  success(message) {
    logger.success(redactPersonalInfo(message));
  },
  warn(message) {
    logger.warn(redactPersonalInfo(message));
  },
  error(message) {
    logger.error(redactPersonalInfo(message));
  },
  plain(message) {
    logger.plain(redactPersonalInfo(message));
  },
});

export const createSilentLogger = (): Logger => ({
  info() {},
  success() {},
  warn() {},
  error() {},
  plain() {},
});

export const redactPersonalInfo = (value: string): string =>
  value.replace(emailPattern, "[hidden email]");
