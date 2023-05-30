import { logger } from './logger.js';

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
  return workers;
}

export { listWorkers };
