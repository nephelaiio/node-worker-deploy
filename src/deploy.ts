/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import * as fs from 'fs';
import { parse as parseTOML, stringify } from '@iarna/toml';

import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CWD } from './constants';

import { debug } from '@nephelaiio/logger';
import {
  Route,
  getWorkerSubdomain,
  getZone,
  listWorkerRoutes,
  createRoute,
  deleteRoute
} from './cloudflare';
import { cli } from './npm';
import { project } from './git';

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

const unique = (xs: any[], property = 'id'): any[] => {
  return Object.values(xs.reduce((acc, obj) => ({ ...acc, [obj[property]]: obj })));
}

async function wrangler(config: (any) => any, fn: () => void) {
  const configSaved = fs.readFileSync(`${CWD}/wrangler.toml`).toString();
  const configObject = parseTOML(configSaved);
  const configEphemeral = config(configObject);
  try {
    debug(
      `Ephemeral wrangler configuration: ${JSON.stringify(configEphemeral)}`
    );
    debug(`Writing ephemeral wrangler configuration`);
    fs.writeFileSync(`${CWD}/wrangler.toml`, stringify(configEphemeral));
    await fn();
  } finally {
    fs.writeFileSync(`${CWD}/wrangler.toml`, configSaved);
    debug(`Restored saved wrangler configuration`);
  }
}

async function deploy(
  name: string,
  variables: { [id: string]: string } = {},
  literals: { [id: string]: string } = {},
  secrets: { [id: string]: string } = {},
  routes: string[] = [],
  workersDev = false
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
  const configString = fs.readFileSync(`${CWD}/wrangler.toml`).toString();
  const config = parseTOML(configString);
  await wrangler(
    (cfg) => {
      cfg.name = name;
      cfg.account_id = accountId;
      cfg.workers_dev = workersDev;
      return cfg;
    },
    async () => {
      const configRoutes = (config.routes || []) as Route[];
      const publishRoutes = [...routeData, ...configRoutes];
      const allRoutes = unique((await listWorkerRoutes(token, accountId)).flat());
      const currentRoutes = unique(allRoutes.filter((r) => r.script == name));
      const addRoutes = attrDifference(publishRoutes, currentRoutes, 'pattern');
      const delRoutes = attrDifference(currentRoutes, publishRoutes, 'pattern');
      debug(`Account routes: ${JSON.stringify(allRoutes)}`);
      debug(`Worker routes current: ${JSON.stringify(currentRoutes)}`);
      debug(`Worker routes requested: ${JSON.stringify(publishRoutes)}`);
      debug(`Worker routes to delete: ${JSON.stringify(delRoutes)}`);
      debug(`Worker routes to create: ${JSON.stringify(addRoutes)}`);
      const publishCmd = `npm exec wrangler deploy --minify --node-compat`;
      const publishArgs = `--name ${name} ${varArgs} ${literalArgs}`;
      const publishScript = `${publishCmd} -- ${publishArgs}`;
      const routeDeletes = delRoutes.map((r) => {
        debug(`Deleting route ${r.pattern}`);
        return deleteRoute(token, accountId, r);
      });
      await Promise.all(routeDeletes);
      const publishOutput = cli(publishScript.trim());
      const publishId = `${publishOutput.split(' ').at(-1)}`.trim();
      const routeAdditions = addRoutes.map((r) => {
        debug(`Adding route ${r.pattern}`);
        return createRoute(token, accountId, name, r);
      });
      await Promise.all(routeAdditions);
      const secretCmd = `npm exec wrangler secret put -- --name ${name}`;
      Object.entries(secrets)
        .map(([k, v]) => `echo ${process.env[v]} | ${secretCmd} ${k}`)
        .forEach((s) => cli(s));
      debug(`Publish ID: ${publishId}`);
    }
  );
}

export { deploy, wrangler, workerURL, project };
