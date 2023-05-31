/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from './logger';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

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

export { listWorkers, getWorker, getDeployments, getSubdomain };
