import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { rest } from 'msw';

import repos from './repos.json';
import repoWorkflows from './workflows.metricbeat.json';
import workflow4669422 from './workflows.4669422.json';
import workflow4669423 from './workflows.4669423.json';
import repo193786081 from './repo.193786081.json';
import workers from './workers.json';

export const restHandlers = [
    rest.get('https://api.github.com/nephelaiio/repos', (req, res, ctx) => {
        return res(ctx.status(200), ctx.json(repos));
    }),
    rest.put(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat/actions/enable',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json({}),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),

    rest.get(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat/actions/workflows',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json(repoWorkflows),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),
    rest.get(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat/actions/workflows/469422',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json(workflow4669422),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),
    rest.get(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat/actions/workflows/469423',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json(workflow4669423),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),
    rest.put(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat/actions/workflows/4669422/enable',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json({}),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),
    rest.put(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat/actions/workflows/4669423/enable',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json({}),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),
    rest.get(
        'https://api.github.com/repos/nephelaiio/ansible-role-metricbeat',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json(repo193786081),
                ctx.set('Content-Type', 'application/json')
            );
        }
    ),
    rest.get(
        'https://api.cloudflare.com/client/v4/accounts/nephelaiio/workers/scripts',
        (req, res, ctx) => {
            return res(
                ctx.status(200),
                ctx.json(workers),
                ctx.set('Content-Type', 'application/json')
            );
        }
    )
];

const server = setupServer(...restHandlers);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

//  Close server after all tests
afterAll(() => server.close());

// Reset handlers after each test `important for test isolation`
afterEach(() => server.resetHandlers());
