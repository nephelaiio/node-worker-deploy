import { Command } from 'commander';
import { execSync } from 'child_process';

import git from 'isomorphic-git';

import * as fs from 'fs';
import * as dotenv from 'dotenv';

import { logger, LOG_LEVELS } from './logger.js';
import { listWorkers } from './cloudflare.js';

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

const run = (command: string): string => execute(command, 'run');
const exec = (command: string): string => execute(command, 'exec');
const cli = (command: string): string => execute(command, 'cli');

async function deploy(
  name: string,
  variables: { [id: string]: string } = {},
  literals: { [id: string]: string } = {},
  secrets: { [id: string]: string } = {}
): Promise<void> {
  logger.debug(`Deploying worker ${name}`);
  const varArgs = Object.entries(variables)
    .map(([k, v]) => `${k}:${process.env[v]}`)
    .reduce((x, y) => `${x} --var ${y}`, '');
  const literalArgs = Object.entries(literals)
    .map(([k, v]) => `${k}:${v}`)
    .reduce((x, y) => `${x} --var ${y}`, '');
  const publishCmd = `wrangler publish`;
  const publishArgs = `--name ${name} ${varArgs} ${literalArgs}`;
  const publishScript = `${publishCmd} -- ${publishArgs}`;
  const publishOutput = exec(publishScript);
  const publishId = `${publishOutput.split(' ').at(-1)}`.trim();
  const secretCmd = `npm exec wrangler secret put -- --name ${name}`;
  Object.entries(secrets)
    .map(([k, v]) => `echo ${process.env[v]} | ${secretCmd} ${k}`)
    .forEach((s) => cli(s));
  logger.debug(`Publish ID: ${publishId}`);
}

async function checkEnvironment() {
  if (!CLOUDFLARE_API_TOKEN) {
    logger.fatal('CLOUDFLARE_API_TOKEN environment variable must be set');
    process.exit(1);
  }
  if (!CLOUDFLARE_ACCOUNT_ID) {
    logger.fatal('CLOUDFLARE_ACCOUNT_ID environment variable must be set');
    process.exit(1);
  }
  if (!fs.existsSync('wrangler.toml')) {
    logger.fatal('Could not find wrangler.toml in working directory');
    process.exit(1);
  }
}

async function checkSecrets(secrets: string[]) {
  logger.debug('Checking secret variables');
  Object.entries(secrets).forEach(([_, v]) => {
    if (!process.env[v]) {
      logger.fatal(`Environment variable '${v}' must be set`);
      process.exit(1);
    }
  });
  logger.debug('Secret validation successful');
}

async function checkVariables(variables: { [id: string]: string }) {
  logger.debug('Checking enrironment variables');
  Object.entries(variables).forEach(([_, v]) => {
    if (!process.env[v]) {
      logger.fatal(`Environment variable '${v}' must be set`);
      process.exit(1);
    }
  });
  logger.debug('Environment validation successful');
}

function workerName(project: string, branch: string): string {
  if (branch == 'main' || branch == 'master') {
    return project;
  } else {
    return `${project}-${branch}`;
  }
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
  logger.debug('Deploying project {project}');
  logger.debug('Deploying branch {branch}');
  const program = new Command();
  const checks: Promise<void>[] = [];
  const collect = (value: string, previous: string[]) =>
    previous.concat([value]);

  program
    .version('0.0.1', '--version', 'output the current version')
    .description('page deployment tool')
    .helpOption('-h, --help', 'output usage information')
    .option('-v, --verbose', 'verbose output', false)
    .option('-q, --quiet', 'quiet output (overrides verbose)', false)
    .option('-k, --insecure', 'disable ssl verification', false)
    .hook('preAction', (program, _) => {
      const isVerbose = program.opts()['verbose'];
      const isQuiet = program.opts()['quiet'];
      const isInsecure = program.opts()['insecure'];
      if (isVerbose) logger.settings.minLevel = LOG_LEVELS.debug;
      if (isQuiet) logger.settings.minLevel = LOG_LEVELS.fatal;
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
      checks.push(checkSecrets(secretArgs));
      checks.push(checkVariables(varArgs));
      Promise.all(checks).then(() => {
        const worker = workerName(project, `${branch}`);
        logger.info(`Deploying worker ${worker}`);
        deploy(worker, varArgs, literalArgs, secretArgs);
      });
    });

  program.command('delete').action((_) => {
    Promise.all(checks).then(async () => {
      const worker = workerName(project, `${branch}`);
      if (worker != project) {
        const request = await listWorkers(
          `${CLOUDFLARE_API_TOKEN}`,
          `${CLOUDFLARE_ACCOUNT_ID}`
        );
        const workers = request.result;
        const matchWorkers = workers.filter((w: any) => w.id == worker);
        if (matchWorkers.length > 0) {
          logger.info(`Deleting worker ${worker}`);
          run(`wrangler delete --name ${worker}`);
        } else {
          logger.debug(`Worker ${worker} not found`);
        }
      }
    });
  });
  program.parse(process.argv);
}

main();
