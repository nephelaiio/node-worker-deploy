/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from './logger';
import { Octokit } from 'octokit';

async function listGithubDeployments(
  githubToken: string,
  repository: string,
  environment: string
) {
  logger.debug(
    `Listing deployments for repository '${repository}', environment '${environment}'`
  );
  const query = `ref=${environment}&environment=${environment}`;
  const octokit = new Octokit({ auth: githubToken });
  const deploymentRecords = await octokit.paginate(
    `GET /repos/${repository}/deployments?${query}`
  );
  const deployments = deploymentRecords || [];
  const sortedDeployments = deployments.sort((x: any, y: any) => {
    const xDate = new Date(x.updated_at);
    const yDate = new Date(y.updated_at);
    return xDate.getDate() - yDate.getDate();
  });
  logger.debug(
    `Found ${sortedDeployments.length} deployments for repository '${repository}', environment '${environment}'`
  );
  return sortedDeployments;
}

async function initGithubDeployment(
  githubToken: string,
  repository: string,
  environment: string
) {
  logger.debug(`Retrieving Github deployment for environment '${environment}'`);
  const deploymentRecords = await listGithubDeployments(
    githubToken,
    repository,
    environment
  );
  const deployments = deploymentRecords || [];
  if (deployments.length > 0) {
    const deployment: any = deployments[0];
    logger.debug(`Found existing deployment with id ${deployment.id}`);
    return deployment.id;
  } else {
    const octokit = new Octokit({ auth: githubToken });
    const deployment: any = await octokit.request(
      `POST /repos/${repository}/deployments`,
      {
        ref: environment,
        environment: environment,
        required_contexts: [],
        transient_environment: true
      }
    );
    if (!deployment) {
      logger.debug(`Unable to create deployment for repository ${repository}`);
      throw new Error(
        `Unable to create deployment for repository ${repository}`
      );
    } else {
      logger.debug(`Created deployment ${JSON.stringify(deployment)}`);
    }
    return deployment.data.id;
  }
}

async function createGithubDeployment(
  githubToken: string,
  repository: string,
  environment: string,
  url: string
) {
  logger.debug(
    `Creating Github deployment for repository '${repository}', environment '${environment}'`
  );
  const octokit = new Octokit({ auth: githubToken });
  await octokit.request(
    `PUT /repos/${repository}/environments/${environment}`,
    {
      wait_timer: 0,
      reviewers: null,
      deployment_branch_policy: null
    }
  );
  const deploymentId = await initGithubDeployment(
    `${githubToken}`,
    repository,
    environment
  );
  logger.debug(`Created deployment with id '${deploymentId}'`);
  logger.debug(
    `Creating Github deployment status for deployment '${deploymentId}'`
  );
  const deploymentStatus: any = await octokit.request(
    `POST /repos/${repository}/deployments/${deploymentId}/statuses`,
    {
      state: 'success',
      environment_url: url,
      auto_inactive: true
    }
  );
  if (!deploymentStatus) {
    logger.debug(
      `Unable to create deployment status for deployment ${deploymentId}`
    );
    throw new Error(
      `Unable to create deployment status for deployment ${deploymentId}`
    );
  } else {
    logger.debug(
      `Created deployment status with id '${deploymentStatus.data.id}'`
    );
  }
}

async function cleanGithubDeployments(
  githubToken: string,
  repository: string,
  environment: string,
  keepDeployments = 0
): Promise<void> {
  const octokit = new Octokit({ auth: githubToken });
  const allDeployments = await listGithubDeployments(
    githubToken,
    repository,
    environment
  );
  logger.debug(
    `Found ${allDeployments.length} deployments for environment '${environment}'`
  );
  if (allDeployments.length > keepDeployments) {
    const extraDeployments = allDeployments.slice(
      0,
      allDeployments.length - keepDeployments
    );
    logger.debug(`Removing ${extraDeployments.length} deployments`);
    for (const extraDeployment of extraDeployments) {
      const deployment: any = extraDeployment;
      logger.debug(
        `Removing deployment '${deployment.id}': '${deployment.updated_at}'`
      );
      const inactive = { state: 'inactive' };
      await octokit.request(
        `POST /repos/${repository}/deployments/${deployment.id}/statuses`,
        inactive
      );
      await octokit.request(
        `DELETE /repos/${repository}/deployments/${deployment.id}`
      );
      logger.debug(`Deployment '${deployment.id}' removed`);
    }
  }
}

export {
  createGithubDeployment,
  cleanGithubDeployments,
  listGithubDeployments
};
