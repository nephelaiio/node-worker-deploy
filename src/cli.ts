/* eslint-disable @typescript-eslint/no-explicit-any */

import { Command, Option } from 'commander';

import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CWD } from './constants';
import { logger, verbose, quiet, info } from './logger';
import { getWorker } from './cloudflare';
import { createGithubDeployment, cleanGithubDeployments } from './github';
import {
  deploy,
  wrangler,
  workerURL,
  defaultWorkerName,
  project,
  branch
} from './deploy';
import { getWorkerSubdomain } from './cloudflare';
import { exec } from './npm';

import * as fs from 'fs';
import * as dotenv from 'dotenv';

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
  const domain = await getWorkerSubdomain(token, account);
  if (!domain) {
    logger.error('Cloudflare workers.dev subdomain must be set for account');
    process.exit(1);
  }
}

async function main() {
  if (fs.existsSync(`${CWD}/.env`)) {
    dotenv.config({ path: `${CWD}/.env` });
  }
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
      new Option('-e, --env <env>', 'repository environment').default('')
    )
    .addOption(
      new Option('-d, --subdomain <string>', 'worker subdomain').default('')
    )
    .action(async (options) => {
      const githubToken = process.env['GITHUB_TOKEN'];
      const githubRepo = process.env['GITHUB_REPOSITORY'];
      const workerArg = program.opts()['name'];
      const worker = workerArg != '' ? workerArg : await defaultWorkerName();
      const environmentArg = options.environment;
      const secretArgs = options.secret.reduce(
        (x: { [id: string]: string }, y: string) => {
          const ySplit = y.split(':');
          if (ySplit.length > 1) {
            return { ...x, ...{ [ySplit[0]]: ySplit[1] } };
          } else {
            return { ...x, ...{ [y]: y } };
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
            return { ...x, ...{ [y]: y } };
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
            return { ...x, ...{ [y]: y } };
          }
        },
        {}
      );
      checks.push(checkSecrets(secretArgs));
      checks.push(checkVariables(varArgs));
      if (options.subdomain == '') {
        checks.push(checkWorkerSubdomain());
      }
      await Promise.all(checks);
      const action = async () => {
        logger.info(`Deploying worker ${worker}`);
        try {
          await deploy(worker, varArgs, literalArgs, secretArgs, options.route);
        } catch (e) {
          logger.error('Error deploying worker. Aborting');
          process.exit(1);
        }
        const url = await workerURL(worker, options.subdomain);
        if (process.env['GITHUB_ACTIONS'] == 'true') {
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
      };
      await action();
    });

  program
    .command('delete')
    .addOption(
      new Option('-e, --env <env>', 'repository environment').default('')
    )
    .action(async (options) => {
      Promise.all(checks).then(async () => {
        const projectName = await project(program.opts()['remote']);
        const workerArg = program.opts()['name'];
        const worker = workerArg != '' ? workerArg : await defaultWorkerName();
        const environmentArg = options.environment;
        if (worker != projectName) {
          const deployment = await getWorker(
            `${CLOUDFLARE_API_TOKEN}`,
            `${CLOUDFLARE_ACCOUNT_ID}`,
            worker
          );
          if (deployment) {
            logger.info(`Deleting worker ${worker}`);
            const accountId = `${CLOUDFLARE_ACCOUNT_ID}`;
            wrangler(
              (cfg) => {
                cfg.name = worker;
                cfg.account_id = accountId;
                return cfg;
              },
              () => {
                exec(`wrangler delete --name ${worker}`);
              }
            );
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
