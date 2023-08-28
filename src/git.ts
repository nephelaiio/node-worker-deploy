import * as fs from 'fs';
import git from 'isomorphic-git';

import { CWD } from './constants';
import { logger } from './logger';

async function project(remote = ''): Promise<string> {
  const gitRemote = await git.getConfig({
    fs,
    dir: CWD,
    path: 'remote.origin.url'
  });
  const origin = remote != '' ? remote : gitRemote;
  const repo = origin
    .replace('git@', '')
    .replace('https://', '')
    .replace('.git' + '', '')
    .replace(':', '/')
    .split('/')
    .slice(-2)
    .join('/')
    .split('/')
    .at(-1);
  return repo;
}

async function branch(name = ''): Promise<string> {
  logger.debug(`CWD: ${CWD}`);
  const gitBranch = await git.currentBranch({ fs, dir: CWD });
  const branch = name != '' ? name : gitBranch;
  return `${branch}`;
}

export { project, branch };
