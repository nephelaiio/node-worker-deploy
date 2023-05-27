/* eslint-disable @typescript-eslint/no-unused-vars */

export interface Env {
    GITHUB_TOKEN: string;
    GITHUB_APPLY: boolean;
}

export default {
    async handleRequest(request: Request, env: Env): Promise<Response> {
        return new Response(
            `Hello world from ${env.GITHUB_APPLY ? 'apply' : 'check'} mode`
        );
    }
};
