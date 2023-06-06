/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from './logger';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
type Route = {
  pattern: string;
  zone_id: any;
};

const cloudflareAPI = async (
  token: string,
  path: string,
  method: ApiMethod = 'GET',
  body: object | null = null
): Promise<any> => {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  const uri = `https://api.cloudflare.com/client/v4${path}`;
  logger.debug(`Fetching ${uri}`);
  async function fetchData(url: string) {
    if (method == 'GET' || method == 'HEAD' || body == null) {
      return await fetch(url, {
        method,
        headers
      });
    } else {
      return await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body)
      });
    }
  }
  const data: any = (await fetchData(uri)).json();
  const isPaged = data.result_info && data.result_info.total_pages > 1;
  if (method == 'GET' && isPaged) {
    if (data.result_info.total_pages > 1) {
      const pages = data.result_info.total_pages;
      const range = [...Array(pages - 1).keys()].map((x) => x + 1);
      const pageData = range
        .map(async (page) => {
          logger.debug(`Fetching ${uri}`);
          const pageResult = await fetchData(`${uri}?page=${page}`);
          return pageResult.json();
        })
        .reduce(async (data, page) => data.concat(await page), data.result);
      return pageData;
    }
  } else {
    return data;
  }
};

async function listWorkers(token: string, account: string): Promise<any> {
  const workers = await cloudflareAPI(
    token,
    `/accounts/${account}/workers/scripts`
  );
  return workers.result;
}

async function getWorker(
  token: string,
  account: string,
  name: string
): Promise<any> {
  const workers = await listWorkers(token, account);
  const matchWorkers = workers.filter((w: any) => w.id == name);
  if (matchWorkers.length > 0) {
    return matchWorkers[0];
  } else {
    return null;
  }
}

async function getSubdomain(token: string, account: string): Promise<any> {
  const subdomainQuery = await cloudflareAPI(
    token,
    `/accounts/${account}/workers/subdomain`
  );
  const subdomains = subdomainQuery.result;
  if (subdomains) {
    return subdomains.subdomain;
  } else {
    return null;
  }
}

async function getDeployments(
  token: string,
  account: string,
  name: string
): Promise<any> {
  const worker = await getWorker(token, account, name);
  if (worker) {
    const domainQuery = await cloudflareAPI(
      token,
      `/accounts/${account}/workers/deployments/by-script/${name}`
    );
    const domains = domainQuery.result;
    if (domains) {
      domains.result.map(JSON.stringify).map(logger.debug);
      return domains;
    }
  }
  return null;
}

async function getZone(
  token: string,
  account: string,
  zone: string
): Promise<any> {
  logger.debug(`Fetching zone data for domain '${zone}'`);
  const zoneQuery = await cloudflareAPI(
    token,
    `/zones?account.id=${account}&name=${zone}`
  );
  const zones = zoneQuery.result;
  if (zones) {
    zone = zones[0];
    logger.debug('Found zone record ${JSON.stringify(zone)}');
    return zone;
  } else {
    logger.debug('No zones matched query');
    return null;
  }
}

async function listZones(token: string, account: string): Promise<any> {
  logger.debug(`Listing zones for account '${account}'`);
  const zoneQuery = await cloudflareAPI(token, '/zones');
  const zones = zoneQuery.result;
  if (zones) {
    logger.debug(`Found ${zones.length} zone records`);
    return zones;
  } else {
    logger.debug('No zones found');
    return [];
  }
}

async function listRoutes(token: string, account: string): Promise<any> {
  logger.debug(`Fetching account worker routes`);
  const zoneRoutes = async (zone: string) => {
    logger.debug(`Fetching routes for zone '${zone}'`);
    const routeQuery = await cloudflareAPI(
      token,
      `/zones/${zone}/workers/routes`
    );
    const routes = routeQuery.result;
    return routes;
  };
  const zones = await listZones(token, account);
  const routes = await Promise.all(zones.map((x: any) => x.id).map(zoneRoutes));
  if (routes) {
    routes.map((x) => {
      if (x.length > 0) {
        logger.debug(`Found route ${JSON.stringify(x)}`);
      }
    });
    return routes;
  } else {
    logger.debug('No routes found');
    return [];
  }
}

export {
  Route,
  listWorkers,
  getWorker,
  getDeployments,
  getSubdomain,
  getZone,
  listRoutes
};
