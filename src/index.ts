/* eslint-disable @typescript-eslint/no-unused-vars */

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_APPLY: boolean;
  WORKER: string;
}

async function fetch(request: Request, env: Env, _: ExecutionContext) {
  return handleRequest(request, env);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const mode = env.GITHUB_APPLY ? 'apply' : 'check';
  const worker = env.WORKER;
  return new Response(`Hello world on ${request.url} from ${worker} using ${mode} mode`);
}

export default { fetch };
