/* eslint-disable @typescript-eslint/no-explicit-any */

import { execSync } from 'child_process';
import { debug, error } from '@nephelaiio/logger';

function execute(
  command: string,
  mode: 'run' | 'exec' | 'cli' = 'exec'
): string {
  const npm = `npm ${mode} -- `;
  const cmd = `${mode == 'cli' ? '' : npm}${command}`;
  try {
    debug(`Executing '${cmd}'`);
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000
    }).toString();
    debug(`'${cmd}' executed successfully`);
    return output;
  } catch (exception: any) {
    const { status } = exception;
    error(`Command execution failed with status ${status || 'interrupted'}`);
    throw new Error(`Failed to execute '${cmd}'`);
  }
}

const exec = (command: string): string => execute(command, 'exec');
const cli = (command: string): string => execute(command, 'cli');

export { exec, cli };
