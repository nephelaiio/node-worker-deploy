import { createLogger, transports, format, config } from 'winston';

const LOG_LEVELS = {
  debug: 'debug',
  info: 'info',
  fatal: 'error'
};

const stdErrTransport = new transports.Console({
  stderrLevels: ['error', 'warn', 'info', 'debug'],
  format: format.combine(
    format.timestamp(),
    format.align(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level.toUpperCase()} ${message}`;
    })
  )
});

const logger = createLogger({
  transports: [stdErrTransport]
});

logger.levels;

type messages = {
  debug: string[];
};
const empty: messages = {
  debug: []
};

function init(level: string, messages: messages = empty): void {
  logger.level = level;
  messages.debug.map(logger.debug);
}

const info = (msgs: messages = empty) => init(LOG_LEVELS.debug, msgs);
const verbose = (msgs: messages = empty) => init(LOG_LEVELS.debug, msgs);
const quiet = (msgs: messages = empty) => init(LOG_LEVELS.fatal, msgs);

export { logger, verbose, quiet, info };
