/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Command, Option } from 'commander';
import { execSync } from 'child_process';
import { parse as parseTOML, stringify } from '@iarna/toml';

import git from 'isomorphic-git';

import * as fs from 'fs';
import * as dotenv from 'dotenv';

import { logger, verbose, quiet, info } from './logger';
import { getWorker, getSubdomain, getZone, listRoutes } from './cloudflare';
import { createGithubDeployment, cleanGithubDeployments } from './github';

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || null;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || null;
const CWD = process.cwd();

if (fs.existsSync(`${CWD}/.env`)) {
  dotenv.config({ path: `${CWD}/.env` });
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
  secrets: { [id: string]: string } = {},
  routes: string[] = []
): Promise<void> {
  const token = `${CLOUDFLARE_API_TOKEN}`;
  const accountId = `${CLOUDFLARE_ACCOUNT_ID}`;
  const varArgs = Object.entries(variables)
    .map(([k, v]) => `--var ${k}:${process.env[v]}`)
    .join(' ');
  const literalArgs = Object.entries(literals)
    .map(([k, v]) => `--var ${k}:${v}`)
    .join(' ');
  const routeData = await Promise.all(
    routes.map(async (route) => {
      const pattern = route;
      const fqdn = route.split('/')[0];
      const zone = fqdn.split('.').slice(-2).join('.');
      const zoneData = await getZone(token, accountId, zone);
      const zone_id = zoneData.id;
      return { pattern, zone_id };
    })
  );
  const configTOML = fs.readFileSync(`${CWD}/wrangler.toml`).toString();
  const config = parseTOML(configTOML);
  try {
    const configRoutes = (config.routes || []) as {
      pattern: string;
      zone_id: any;
    }[];
    const publishRoutes = [...routeData, ...configRoutes];
    const currentRoutes = await listRoutes(token, accountId);
    process.exit(1);
    const publishCmd = `npm exec wrangler deploy --minify --node-compat`;
    const publishArgs = `--name ${name} ${varArgs} ${literalArgs}`;
    const publishScript = `${publishCmd} -- ${publishArgs}`;
    const publishOutput = cli(publishScript.trim());
    const publishId = `${publishOutput.split(' ').at(-1)}`.trim();
    const secretCmd = `npm exec wrangler secret put -- --name ${name}`;
    Object.entries(secrets)
      .map(([k, v]) => `echo ${process.env[v]} | ${secretCmd} ${k}`)
      .forEach((s) => cli(s));
    logger.debug(`Publish ID: ${publishId}`);
  } finally {
    fs.writeFileSync(`${CWD}/wrangler.toml`, stringify(config));
  }
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
  logger.debug('Checking environment variables');
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
  const domain = await getSubdomain(token, account);
  if (!domain) {
    logger.error('Cloudflare workers.dev subdomain must be set for account');
    process.exit(1);
  }
}

async function defaultWorkerName(): Promise<string> {
  const _project = await project();
  const _branch = await branch();
  if (_branch == 'main' || _branch == 'master') {
    return _project;
  } else {
    return `${_project}-${_branch}`;
  }
}

async function workerURL(
  name: string,
  subdomain = '',
  token = `${CLOUDFLARE_API_TOKEN}`,
  account = `${CLOUDFLARE_ACCOUNT_ID}`
): Promise<string> {
  const domain =
    subdomain != '' ? subdomain : await getSubdomain(token, account);
  return `https://${name}.${domain}.workers.dev`;
}

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
  const gitBranch = await git.currentBranch({ fs, dir: CWD });
  const branch = name != '' ? name : gitBranch;
  return `${branch}`;
}

async function main() {
  const program = new Command();
  const checks: Promise<void>[] = [];
  const collect = (value: string, previous: string[]) =>
    previous.concat([value]);

  program
    .version(__VERSION__, '--version', 'output the current version')
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
    .addOption(
      new Option('-n, --name <string>', 'worker deployment name').default('')
    )
    .hook('preAction', async (program, _) => {
      const isVerbose = program.opts()['verbose'];
      const isQuiet = program.opts()['quiet'];
      const isInsecure = program.opts()['insecure'];
      const workerArg = program.opts()['name'];
      const worker = workerArg != '' ? workerArg : await defaultWorkerName();
      if (isVerbose) verbose();
      if (isQuiet) quiet();
      if (!isQuiet && !isVerbose) info();
      if (isInsecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      logger.debug(`Deploying worker ${worker}`);
      logger.debug(`Validating deployment parameters`);
      checks.push(checkEnvironment());
    });

  program
    .command('deploy')
    .option('-s, --secret <string>', 'worker secret [list]', collect, [])
    .option('-l, --literal <string>', 'worker literal [list]', collect, [])
    .option('-v, --variable <string>', 'worker variable (list)', collect, [])
    .option('-r, --route <fqdn>', 'worker route [list]', collect, [])
    .addOption(
      new Option('-d, --subdomain <string>', 'worker subdomain').default('')
    )
    .action(async (options) => {
      const workerArg = program.opts()['name'];
      const worker = workerArg != '' ? workerArg : await defaultWorkerName();
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
      if (options.subdomain == '') {
        checks.push(checkWorkerSubdomain());
      }
      Promise.all(checks).then(async () => {
        logger.info(`Deploying worker ${worker}`);
        try {
          await deploy(worker, varArgs, literalArgs, secretArgs, options.route);
        } catch (e) {
          logger.error('Error deploying worker. Aborting');
          process.exit(1);
        }
        const url = await workerURL(worker, options.subdomain);
        if (process.env['GITHUB_ACTIONS'] == 'true') {
          const githubToken = process.env['GITHUB_TOKEN'];
          const githubRepo = process.env['GITHUB_REPOSITORY'];
          if (githubToken) {
            if (githubRepo) {
              const environment = await branch();
              logger.debug(
                `Registering deployment for github repository ${githubRepo}, environment ${environment}`
              );
              await createGithubDeployment(
                `${githubToken}`,
                `${githubRepo}`,
                `${environment}`,
                url
              );
            } else {
              logger.debug(
                'GITHUB_REPOSITORY env variable is not defined; skipping deployment configuration'
              );
            }
          } else {
            logger.debug(
              'GITHUB_TOKEN env variable is not defined; skipping deployment configuration'
            );
          }
        }
        console.log(url);
      });
    });

  program.command('delete').action((_) => {
    Promise.all(checks).then(async () => {
      const projectName = await project(program.opts()['remote']);
      const workerArg = program.opts()['name'];
      const worker = workerArg != '' ? workerArg : await defaultWorkerName();
      if (worker != projectName) {
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
        if (process.env['GITHUB_ACTIONS'] == 'true') {
          const githubToken = process.env['GITHUB_TOKEN'];
          const githubRepo = process.env['GITHUB_REPOSITORY'];
          if (githubToken) {
            if (githubRepo) {
              const environment = await branch();
              logger.debug(
                `Deleting deployments for github repository ${githubRepo}, environment ${environment}`
              );
              await cleanGithubDeployments(
                `${githubToken}`,
                `${githubRepo}`,
                `${environment}`
              );
            } else {
              logger.debug(
                'GITHUB_REPOSITORY env variable is not defined; skipping deployment configuration'
              );
            }
          } else {
            logger.debug(
              'GITHUB_TOKEN env variable is not defined; skipping deployment configuration'
            );
          }
        }
      }
    });
  });
  program.parse(process.argv);
}

main();
