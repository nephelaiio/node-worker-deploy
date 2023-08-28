import * as fs from 'fs';
import git from 'isomorphic-git';

import { CWD } from './constants';

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

export { project };
