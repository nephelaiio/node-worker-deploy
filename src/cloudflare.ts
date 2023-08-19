/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */

import { logger } from './logger';

const ORIGINLESS_TYPE = 'AAAA';
const ORIGINLESS_CONTENT = '100::';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
export type Route = {
  pattern: string;
  zone_id: any;
  id?: string;
};

const cloudflareAPI = async (
  token: string,
  path: string,
  method: ApiMethod = 'GET',
  body: object | null = null,
  expected_errors: Array<number> = []
): Promise<any> => {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  const uri = `https://api.cloudflare.com/client/v4${path}`;
  logger.debug(`Fetching ${method} ${uri}`);
  async function fetchData(url: string) {
    if (method == 'GET' || method == 'HEAD' || body == null) {
      const response = await fetch(url, {
        method,
        headers
      });
      if (response.ok) {
        logger.debug(`Got response ${response.status} for ${method} ${uri}`);
        return response;
      } else {
        const error = `Unexpected response ${response.status} for ${method} ${uri}`;
        logger.error(error);
        throw new Error(error);
      }
    } else {
      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body)
      });
      if (response.ok || expected_errors.some((x) => x == response.status)) {
        logger.debug(`Got response ${response.status} for ${uri}`);
        return method != 'DELETE' ? response : null;
      } else {
        logger.error(`Unexpected response ${response.status} for ${uri}`);
        throw new Error(`Unexpected response ${response.status} for ${uri}`);
      }
    }
  }
  const response = await fetchData(uri);
  if (response && method == 'GET') {
    const data: any = response.json();
    const isPaged = data.result_info && data.result_info.total_pages > 1;
    if (isPaged) {
      if (data.result_info.total_pages > 1) {
        const pages = data.result_info.total_pages;
        const range = [...Array(pages - 1).keys()].map((x) => x + 1);
        const pageData = range
          .map(async (page) => {
            logger.debug(`Fetching ${uri}`);
            const pageResult = await fetchData(`${uri}?page=${page}`);
            if (pageResult) {
              return pageResult.json();
            } else {
              return {};
            }
          })
          .reduce(async (data, page) => data.concat(await page), data.result);
        return pageData;
      }
    } else {
      return data;
    }
  } else {
    return {};
  }
};

async function isOriginlessRecord(
  token: string,
  account: string,
  record: any
): Promise<any> {
  const domain = record.split('.').slice(-2).join('.');
  const zone = await getZone(token, account, domain);
  logger.debug(`Querying data for record '${record}'`);
  const request = await cloudflareAPI(
    token,
    `/zones/${zone.id}/dns_records?name=${record}`
  );
  const records = request.result;
  if (records.length == 0) {
    logger.debug(`No records found, marking record '${record}' as origin`);
    return null;
  } else {
    const matchRecord = records[0];
    const isSingleRecord = records.length == 1;
    const isMatchType = matchRecord.type == ORIGINLESS_TYPE;
    const isMatchContent = matchRecord.content == ORIGINLESS_CONTENT;
    if (isSingleRecord && isMatchType && isMatchContent) {
      logger.debug(`Marking '${record}' as originless`);
      return matchRecord;
    } else {
      logger.debug(`Marking '${record}' as origin`);
      return null;
    }
  }
}

async function createOriginlessRecord(
  token: string,
  account: string,
  record: any
): Promise<any> {
  const domain = record.split('.').slice(-2).join('.');
  const zone = await getZone(token, account, domain);
  logger.debug(`Querying data for record '${record}'`);
  const request = await cloudflareAPI(
    token,
    `/zones/${zone.id}/dns_records?name=${record}`
  );
  const records = request.result;
  if (records.length == 0) {
    logger.debug(`Creating originless record ${record}`);
    await cloudflareAPI(
      token,
      `/zones/${zone.id}/dns_records/${record}`,
      'POST',
      {
        name: record,
        content: ORIGINLESS_CONTENT,
        type: ORIGINLESS_TYPE,
        proxied: true
      },
      [405]
    );
    logger.debug(`Created originless record ${record}`);
  }
}

async function deleteOriginlessRecord(
  token: string,
  account: string,
  record: any
): Promise<any> {
  const domain = record.split('.').slice(-2).join('.');
  const zone = await getZone(token, account, domain);
  logger.debug(`Deleting originless record ${record}`);
  const originlessRecord = await isOriginlessRecord(token, account, record);
  if (originlessRecord) {
    await cloudflareAPI(
      token,
      `/zones/${zone.id}/dns_records/${originlessRecord.id}`,
      'DELETE',
      null,
      [405]
    );
  } else {
    logger.debug('Origin record detected, skipping');
  }
}

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

async function getWorkerSubdomain(
  token: string,
  account: string
): Promise<any> {
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
    const zoneData = zones[0];
    logger.debug(`Found record for zone ${zone} with id ${zoneData.id}`);
    return zoneData;
  } else {
    logger.debug('No zones matched query');
    return null;
  }
}

async function listWorkerDomains(token: string, account: string): Promise<any> {
  logger.debug(`Listing worker domains for account '${account}'`);
  const request = await cloudflareAPI(
    token,
    `/accounts/${account}/workers/domains`
  );
  const domains = request.result;
  if (domains) {
    logger.debug(`Found ${domains.length} worker domains`);
    return domains;
  } else {
    logger.debug('No worker domains found');
    return [];
  }
}

async function listWorkerDomainRoutes(
  token: string,
  domain: string
): Promise<any> {
  logger.debug(`Fetching routes for zone '${domain}'`);
  const routeQuery = await cloudflareAPI(
    token,
    `/zones/${domain}/workers/routes`,
    'GET',
    null,
    [404]
  );
  if (routeQuery.status == 404) {
    logger.debug(`No routes found for zone '${domain}'`);
    return [];
  } else {
    const routes = routeQuery.result;
    logger.debug(`Found '${routes.length}' matching routes`);
    return routes;
  }
}

async function listWorkerRoutes(token: string, account: string): Promise<any> {
  logger.debug(`Fetching account worker routes`);
  const domainRoutes = async (domain: any) =>
    listWorkerDomainRoutes(token, domain);
  const domains = await listWorkerDomains(token, account);
  const routes = await Promise.all(
    domains.map((x: any) => x.zone_id).map(domainRoutes)
  );
  if (routes) {
    routes.flat().map((x) => {
      logger.debug(`Found route ${x.pattern}`);
    });
    return routes.flat();
  } else {
    logger.debug('No routes found');
    return [];
  }
}

async function createRoute(
  token: string,
  account: string,
  worker: string,
  route: Route
): Promise<any> {
  const hostname = route.pattern.split('/')[0];
  const domain = hostname.split('.').slice(-2).join('.');
  const zone = await getZone(token, account, domain);
  const domains = await listWorkerDomains(token, account);
  if (domains.filter((x: any) => x.zone_id == zone.id).length == 0) {
    logger.debug(`Attaching ${worker} to domain ${domain}`);
    await cloudflareAPI(
      token,
      `/accounts/${account}/workers/domains`,
      'PUT',
      {
        environment: 'production',
        hostname,
        service: worker,
        zone_id: zone.id
      },
      [200, 409]
    );
  }
  await createOriginlessRecord(token, account, hostname);
  const routes = await listWorkerRoutes(token, account);
  logger.debug(`Existing routes: ${routes.map((x: any) => x.pattern)}`);
  if (routes.filter((x: any) => x.pattern == route.pattern).length == 0) {
    logger.debug(`Adding worker route for pattern ${route.pattern}`);
    await cloudflareAPI(token, `/zones/${zone.id}/workers/routes`, 'POST', {
      pattern: route.pattern,
      script: worker
    });
    logger.debug(
      `Worker route for pattern ${route.pattern} added successfully`
    );
  }
}

// destroy originless record if necessary
async function deleteRoute(
  token: string,
  account: string,
  route: Route
): Promise<any> {
  const hostname = route.pattern.split('/')[0];
  const domain = hostname.split('.').slice(-2).join('.');
  const zone = await getZone(token, account, domain);
  logger.debug(`Deleting worker route for pattern ${route.pattern}`);
  const response = await cloudflareAPI(
    token,
    `/zones/${zone.id}/workers/routes/${route.id}`,
    'DELETE'
  );
  logger.debug(
    `Worker route for pattern ${route.pattern} deleted successfully`
  );
  const domainRoutes = await listWorkerDomainRoutes(token, zone.id);
  const matchingRoutes = domainRoutes.filter(
    (x: any) => x.pattern.split('/')[0] == hostname
  );
  if (matchingRoutes.length == 0) {
    logger.debug(`Deleting originless record for ${hostname}`);
    await deleteOriginlessRecord(token, account, hostname);
  }
  if (domainRoutes.length == 0) {
    const domains = await listWorkerDomains(token, account);
    const matchDomains = domains.filter((x: any) => x.zone_id == zone.id);
    if (matchDomains.length > 0) {
      const domain = matchDomains[0];
      logger.debug(`Detaching domain ${domain.zone_name} from workers`);
      await cloudflareAPI(
        token,
        `/accounts/${account}/workers/domains/${domain.id}`,
        'DELETE',
        null,
        [404]
      );
      logger.debug(`Detached domain ${domain.zone_name} from workers`);
    }
  }
  return response.result;
}

export {
  listWorkers,
  getWorker,
  getDeployments,
  getWorkerSubdomain,
  getZone,
  listWorkerRoutes,
  createRoute,
  deleteRoute
};
