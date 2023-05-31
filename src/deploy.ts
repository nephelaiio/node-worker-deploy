#!/usr/bin/env node

import { Command, Option } from 'commander';
import { execSync } from 'child_process';

import git from 'isomorphic-git';

import * as fs from 'fs';
import * as dotenv from 'dotenv';

import { logger, verbose, quiet, info } from './logger.js';
import { getWorker, getSubdomain } from './cloudflare.js';

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || null;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || null;
const cwd = process.cwd();

if (fs.existsSync(`${cwd}/.env`)) {
  dotenv.config({ path: `${process.cwd()}/.env` });
}

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

async function deploy(
  name: string,
  variables: { [id: string]: string } = {},
  literals: { [id: string]: string } = {},
  secrets: { [id: string]: string } = {}
): Promise<void> {
  const varArgs = Object.entries(variables)
    .map(([k, v]) => `${k}:${process.env[v]}`)
    .reduce((x, y) => `${x} --var ${y}`, '');
  const literalArgs = Object.entries(literals)
    .map(([k, v]) => `${k}:${v}`)
    .reduce((x, y) => `${x} --var ${y}`, '');
  const publishCmd = `npm exec wrangler deploy --minify --node-compat`;
  const publishArgs = `--name ${name} ${varArgs} ${literalArgs}`;
  const publishScript = `${publishCmd} -- ${publishArgs}`;
  const publishOutput = cli(publishScript);
  const publishId = `${publishOutput.split(' ').at(-1)}`.trim();
  const secretCmd = `npm exec wrangler secret put -- --name ${name}`;
  Object.entries(secrets)
    .map(([k, v]) => `echo ${process.env[v]} | ${secretCmd} ${k}`)
    .forEach((s) => cli(s));
  logger.debug(`Publish ID: ${publishId}`);
}

async function checkEnvironment() {
  if (!CLOUDFLARE_API_TOKEN) {
    logger.error('CLOUDFLARE_API_TOKEN environment variable must be set');
    process.exit(1);
  }
  if (!CLOUDFLARE_ACCOUNT_ID) {
    logger.error('CLOUDFLARE_ACCOUNT_ID environment variable must be set');
    process.exit(1);
  }
  if (!fs.existsSync('wrangler.toml')) {
    logger.error('Could not find wrangler.toml in working directory');
    process.exit(1);
  }
}

async function checkSecrets(secrets: string[]) {
  logger.debug('Checking secret variables');
  Object.entries(secrets).forEach(([_, v]) => {
    if (!process.env[v]) {
      logger.error(`Environment variable '${v}' must be set`);
      process.exit(1);
    }
  });
  logger.debug('Secret validation successful');
}

async function checkVariables(variables: { [id: string]: string }) {
  logger.debug('Checking enrironment variables');
  Object.entries(variables).forEach(([_, v]) => {
    if (!process.env[v]) {
      logger.error(`Environment variable '${v}' must be set`);
      process.exit(1);
    }
  });
  logger.debug('Environment validation successful');
}

async function checkWorkerSubdomain(
  token = `${CLOUDFLARE_API_TOKEN}`,
  account = `${CLOUDFLARE_ACCOUNT_ID}`
) {
  const domain = getSubdomain(token, account);
  if (!domain) {
    logger.error('Cloudflare workers.dev subdomain must be set for account');
    process.exit(1);
  }
}

function workerName(project: string, branch: string): string {
  if (branch == 'main' || branch == 'master') {
    return project;
  } else {
    return `${project}-${branch}`;
  }
}

async function workerURL(
  name: string,
  token = `${CLOUDFLARE_API_TOKEN}`,
  account = `${CLOUDFLARE_ACCOUNT_ID}`
): Promise<string> {
  const domain = await getSubdomain(token, account);
  return `https://${name}.${domain}.workers.dev`;
}

async function main() {
  const branch = await git.currentBranch({ fs, dir: cwd });
  const origin = await git.getConfig({
    fs,
    dir: cwd,
    path: 'remote.origin.url'
  });
  const repo = origin
    .replace('git@', '')
    .replace('https://', '')
    .replace('.git' + '', '')
    .replace(':', '/')
    .split('/')
    .slice(-2)
    .join('/');
  const project = repo.split('/').at(-1);
  const asyncLogs = {
    debug: [`Deploying project ${project}`, `Deploying branch ${branch}`]
  };
  const program = new Command();
  const checks: Promise<void>[] = [];
  const collect = (value: string, previous: string[]) =>
    previous.concat([value]);

  program
    .version('0.0.1', '--version', 'output the current version')
    .description('page deployment tool')
    .helpOption('-h, --help', 'output usage information')
    .addOption(
      new Option('-v, --verbose', 'verbose output')
        .default(false)
        .conflicts('quiet')
    )
    .addOption(
      new Option('-q, --quiet', 'quiet output')
        .default(false)
        .conflicts('verbose')
    )
    .addOption(
      new Option('-k, --insecure', 'disable ssl verification').default(false)
    )
    .hook('preAction', (program, _) => {
      const isVerbose = program.opts()['verbose'];
      const isQuiet = program.opts()['quiet'];
      const isInsecure = program.opts()['insecure'];
      if (isVerbose) verbose(asyncLogs);
      if (isQuiet) quiet(asyncLogs);
      if (!isQuiet && !isVerbose) info(asyncLogs);
      if (isInsecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      logger.debug(`Validating deployment parameters`);
      checks.push(checkEnvironment());
    });

  program
    .command('deploy')
    .option('-s, --secret <string>', 'worker secret', collect, [])
    .option('-l, --literal <string>', 'worker literal', collect, [])
    .option('-v, --variable <string>', 'worker variable', collect, [])
    .action((options) => {
      const secretArgs = options.secret.reduce(
        (x: { [id: string]: string }, y: string) => {
          const ySplit = y.split(':');
          if (ySplit.length > 1) {
            return { ...x, ...{ [ySplit[0]]: ySplit[1] } };
          } else {
            return { ...x, ...{ y } };
          }
        },
        {}
      );
      const varArgs = options.variable.reduce(
        (x: { [id: string]: string }, y: string) => {
          const ySplit = y.split(':');
          if (ySplit.length > 1) {
            return { ...x, ...{ [ySplit[0]]: ySplit[1] } };
          } else {
            return { ...x, ...{ y } };
          }
        },
        {}
      );
      const literalArgs = options.literal.reduce(
        (x: { [id: string]: string }, y: string) => {
          const ySplit = y.split(':');
          if (ySplit.length > 1) {
            return { ...x, ...{ [ySplit[0]]: ySplit[1] } };
          } else {
            return { ...x, ...{ y } };
          }
        },
        {}
      );
      const worker = workerName(project, `${branch}`);
      checks.push(checkSecrets(secretArgs));
      checks.push(checkVariables(varArgs));
      checks.push(checkWorkerSubdomain());
      Promise.all(checks).then(() => {
        logger.info(`Deploying worker ${worker}`);
        deploy(worker, varArgs, literalArgs, secretArgs);
        workerURL(worker).then((url) => {
          console.log(url);
        });
      });
    });

  program.command('delete').action((_) => {
    Promise.all(checks).then(async () => {
      const worker = workerName(project, `${branch}`);
      if (worker != project) {
        const deployment = await getWorker(
          `${CLOUDFLARE_API_TOKEN}`,
          `${CLOUDFLARE_ACCOUNT_ID}`,
          worker
        );
        if (deployment) {
          logger.info(`Deleting worker ${worker}`);
          exec(`wrangler delete --name ${worker}`);
        } else {
          logger.debug(`Worker ${worker} not found`);
        }
      }
    });
  });
  program.parse(process.argv);
}

main();
