import { describe, expect, it } from 'vitest';
import { listWorkers } from './cloudflare.js';

const token = process.env.CLOUDFLARE_TOKEN || 'any';

describe('listWorkers', () => {
  it('should return a lst of workers', async () => {
    const data = await listWorkers(token, 'nephelaiio');
    expect(data.result).toHaveLength(2);
    expect(data.result[0]).toHaveProperty('id', 'worker-github-actions');
    expect(data.result[data.result.length - 1]).toHaveProperty(
      'id',
      'worker-github-actions-deploy'
    );
  });
});
