/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */

import { debug, error } from '@nephelaiio/logger';

const ORIGINLESS_TYPE = 'AAAA';
const ORIGINLESS_CONTENT = '100::';
const CLOUDFLARE_TIMEOUT = 5000;
const CLOUDFLARE_RETRIES = 3;
const CLOUDFLARE_BACKOFF = 30;

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
export type Route = {
  pattern: string;
  zone_id: any;
  id?: string;
};

const delay = (n: number) => new Promise((res) => setTimeout(res, n));

const unique = (xs: any[], property = 'id'): any[] => {
  return Object.values(
    xs.reduce((acc, obj) => ({ ...acc, [obj[property]]: obj }))
  );
};

async function retry(
  fn: () => Promise<any>,
  times = CLOUDFLARE_RETRIES,
  backoff = CLOUDFLARE_BACKOFF
) {
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i == times - 1) {
        throw e;
      }
      await delay(backoff * Math.pow(2, i + 1));
    }
  }
}

// from https://dmitripavlutin.com/timeout-fetch-request/
async function fetchWithTimeout(resource: string, options: any) {
  const { timeout = CLOUDFLARE_TIMEOUT } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);

  return response;
}

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
  debug(`Fetching ${method} ${uri}`);
  async function fetchData(url: string) {
    if (method == 'GET' || method == 'HEAD') {
      const response = await retry(
        async () =>
          await fetchWithTimeout(url, {
            method,
            headers
          })
      );
      if (response.ok || expected_errors.some((x) => x == response.status)) {
        debug(`Got response ${response.status} for ${method} ${uri}`);
        return response;
      } else {
        const errorMessage = `Unexpected response ${response.status} for ${method} ${uri}`;
        error(errorMessage);
        throw new Error(errorMessage);
      }
    } else {
      try {
        const response = await fetchWithTimeout(url, {
          method,
          headers,
          body: JSON.stringify(body)
        });
        if (response.ok || expected_errors.some((x) => x == response.status)) {
          debug(`Got response ${response.status} for ${uri}`);
          return method != 'DELETE' ? response : null;
        } else {
          const errorMessage = `Unexpected response ${response.status} for ${method} ${uri}`;
          error(errorMessage);
          throw new Error(errorMessage);
        }
      } catch (_: any) {
        const errorMessage = `Timeout waiting for reponse for ${method} ${uri}`;
        error(errorMessage);
        throw new Error(errorMessage);
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
            debug(`Fetching ${uri}`);
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
  debug(`Querying data for record '${record}'`);
  const request = await cloudflareAPI(
    token,
    `/zones/${zone.id}/dns_records?name=${record}`
  );
  const records = request.result;
  if (records.length == 0) {
    debug(`No records found, marking record '${record}' as origin`);
    return null;
  } else {
    const matchRecord = records[0];
    const isSingleRecord = records.length == 1;
    const isMatchType = matchRecord.type == ORIGINLESS_TYPE;
    const isMatchContent = matchRecord.content == ORIGINLESS_CONTENT;
    if (isSingleRecord && isMatchType && isMatchContent) {
      debug(`Marking '${record}' as originless`);
      return matchRecord;
    } else {
      debug(`Marking '${record}' as origin`);
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
  debug(`Querying data for record '${record}'`);
  const requestTypes = ['A', 'AAAA', 'CNAME'];
  const recordQueries = requestTypes.map(
    async (requestType) =>
      await cloudflareAPI(
        token,
        `/zones/${zone.id}/dns_records?name=${record}&type=${requestType}`
      )
  );
  const recordResults = await Promise.all(recordQueries);
  const records = recordResults.map((x) => x.result).flat();
  debug(`Found records '${JSON.stringify(records)}'`);
  if (records.length == 0) {
    debug(`Creating originless record ${record}`);
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
    debug(`Created originless record ${record}`);
  }
}

async function deleteOriginlessRecord(
  token: string,
  account: string,
  record: any
): Promise<any> {
  const domain = record.split('.').slice(-2).join('.');
  const zone = await getZone(token, account, domain);
  debug(`Deleting originless record ${record}`);
  const originlessRecord = await isOriginlessRecord(token, account, record);
  if (originlessRecord) {
    await cloudflareAPI(
      token,
      `/zones/${zone.id}/dns_records/${originlessRecord.id}`,
      'DELETE',
      null,
      [404]
    );
  } else {
    debug('Origin record detected, skipping');
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
      domains.result.map(JSON.stringify).map(debug);
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
  debug(`Fetching zone data for domain '${zone}'`);
  const zoneQuery = await cloudflareAPI(
    token,
    `/zones?account.id=${account}&name=${zone}`
  );
  const zones = zoneQuery.result;
  if (zones) {
    const zoneData = zones[0];
    debug(`Found record for zone ${zone} with id ${zoneData.id}`);
    return zoneData;
  } else {
    debug('No zones matched query');
    return null;
  }
}

async function listWorkerDomains(token: string, account: string): Promise<any> {
  debug(`Listing worker domains for account '${account}'`);
  const request = await cloudflareAPI(
    token,
    `/accounts/${account}/workers/domains`
  );
  const domains = request.result;
  if (domains) {
    debug(`Found ${domains.length} worker domains`);
    return domains;
  } else {
    debug('No worker domains found');
    return [];
  }
}

async function listWorkerDomainRoutes(
  token: string,
  domain: string
): Promise<any> {
  debug(`Fetching routes for zone '${domain}'`);
  try {
    const routeQuery = await cloudflareAPI(
      token,
      `/zones/${domain}/workers/routes`
    );
    const routes = unique(routeQuery.result);
    debug(`Found '${routes.length}' matching routes`);
    return routes;
  } catch (_) {
    debug(`Unexpected error querying matching routes, ignoring`);
    return [];
  }
}

async function listWorkerRoutes(token: string, account: string): Promise<any> {
  debug(`Fetching account worker routes`);
  const domainRoutes = async (domain: any) =>
    listWorkerDomainRoutes(token, domain);
  debug(`Fetching worker domains`);
  const domainData = await listWorkerDomains(token, account);
  const domains = domainData.filter((x: any) => !(x === null));
  const domainIds = unique(domains, 'zone_id').map((x: any) => x.zone_id);
  debug(`Found domain ids ${JSON.stringify(domainIds)}`);
  const routes = await Promise.all(domainIds.map(domainRoutes));
  if (routes) {
    routes.flat().map((x) => {
      debug(`Found route ${x.id}: ${x.pattern}`);
    });
    return unique(routes.flat());
  } else {
    debug('No routes found');
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
  debug(`Attaching ${worker} to domain ${domain}`);
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
    [409]
  );
  await createOriginlessRecord(token, account, hostname);
  debug(`Adding worker route for pattern ${route.pattern}`);
  await cloudflareAPI(
    token,
    `/zones/${zone.id}/workers/routes`,
    'POST',
    {
      pattern: route.pattern,
      script: worker
    },
    [409]
  );
  debug(`Worker route for pattern ${route.pattern} added successfully`);
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
  debug(`Deleting worker route for pattern ${route.pattern}`);
  const response = await cloudflareAPI(
    token,
    `/zones/${zone.id}/workers/routes/${route.id}`,
    'DELETE',
    null,
    [404]
  );
  debug(`Worker route for pattern ${route.pattern} deleted successfully`);
  const domainRoutes = await listWorkerDomainRoutes(token, zone.id);
  const matchingRoutes = domainRoutes.filter(
    (x: any) => x.pattern.split('/')[0] == hostname
  );
  if (matchingRoutes.length == 0) {
    debug(`Deleting originless record for ${hostname}`);
    await deleteOriginlessRecord(token, account, hostname);
  }
  if (domainRoutes.length == 0) {
    const domains = await listWorkerDomains(token, account);
    const matchDomains = domains.filter((x: any) => x.zone_id == zone.id);
    if (matchDomains.length > 0) {
      const domain = matchDomains[0];
      debug(`Detaching domain ${domain.zone_name} from workers`);
      await cloudflareAPI(
        token,
        `/accounts/${account}/workers/domains/${domain.id}`,
        'DELETE',
        null,
        [404]
      );
      debug(`Detached domain ${domain.zone_name} from workers`);
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
