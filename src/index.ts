/* eslint-disable @typescript-eslint/no-unused-vars */

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_APPLY: boolean;
}

export default {
  async fetch(request: Request, env: Env, _: ExecutionContext) {
    this.handleRequest(request, env);
  },

  async handleRequest(request: Request, env: Env): Promise<Response> {
    const mode = env.GITHUB_APPLY ? 'apply' : 'check';
    return new Response(`Hello world on ${request.url} using ${mode} mode`);
  }
};
