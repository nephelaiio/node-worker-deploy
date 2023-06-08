/* eslint-disable @typescript-eslint/no-explicit-any */

import { execSync } from 'child_process';
import { logger } from './logger';

function execute(
  command: string,
  mode: 'run' | 'exec' | 'cli' = 'exec'
): string {
  const npm = `npm ${mode} -- `;
  const cmd = `${mode == 'cli' ? '' : npm}${command}`;
  try {
    logger.debug(`Executing '${cmd}'`);
    const output = execSync(cmd).toString();
    return output;
  } catch (error: any) {
    const { status } = error;
    logger.error(
      `Command execution failed with status ${status || 'interrupted'}`
    );
    throw new Error(`Failed to execute '${cmd}'`);
  }
}

const exec = (command: string): string => execute(command, 'exec');
const cli = (command: string): string => execute(command, 'cli');

export { exec, cli };
