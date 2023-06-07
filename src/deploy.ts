/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import * as fs from 'fs';
import { parse as parseTOML, stringify } from '@iarna/toml';

import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CWD } from './constants';

import { logger } from './logger';
import {
  Route,
  getWorkerSubdomain,
  getZone,
  listWorkerRoutes,
  createRoute,
  deleteRoute
} from './cloudflare';
import { cli } from './npm';
import { project, branch } from './git';

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
    subdomain != '' ? subdomain : await getWorkerSubdomain(token, account);
  return `https://${name}.${domain}.workers.dev`;
}

const attrDifference = (x: any[], y: any[], property: string) => {
  return x.filter((j) => !y.some((k) => j[property] == k[property]));
};

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
  const routeData: Route[] = await Promise.all(
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
    const configRoutes = (config.routes || []) as Route[];
    const publishRoutes = [...routeData, ...configRoutes];
    const currentRoutes = (await listWorkerRoutes(token, accountId)).flat();
    const addRoutes = attrDifference(publishRoutes, currentRoutes, 'pattern');
    const delRoutes = attrDifference(currentRoutes, publishRoutes, 'pattern');
    addRoutes.map((r) => {
      logger.debug(`Adding route ${r.pattern}`);
      createRoute(token, accountId, name, r);
    });
    delRoutes.map((r) => {
      logger.debug(`Deleting route ${r.pattern}`);
      deleteRoute(token, accountId, r);
    });
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

export { deploy, workerURL, defaultWorkerName, project, branch };
