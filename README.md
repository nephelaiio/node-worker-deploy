# Worker Deploy

[![Test](https://github.com/nephelaiio/node-worker-deploy/actions/workflows/test.yml/badge.svg)](https://github.com/nephelaiio/node-worker-github-actions/actions/workflows/test.yml)
[![Deploy](https://github.com/nephelaiio/node-worker-deploy/actions/workflows/publish.yml/badge.svg)](https://github.com/nephelaiio/node-worker-github-actions/actions/workflows/main.yml)

Worker deploy is an NPM package that uses
[Cloudflare Workers API](https://developers.cloudflare.com/workers) to automate
Cloudflare Worker and Secret deployments

## Usage

Apply the following steps in your CI configuration at the appropriate stages

```
- name: Deploy Cloudflare worker with custom domain
  run: |
    echo Deploying worker "$WORKER"; \
    npx @nephelaiio/worker-deploy -- \
       deploy \
       --verbose \
       --literal GITHUB_APPLY:true \
       --secret GITHUB_TOKEN:GH_TOKEN \
       --name "$WORKER" \
       --route "$FQDN/*"
```

```

- name: Destroy Cloudflare worker
  run: |
    echo Deploying worker "$WORKER"; \
    npx @nephelaiio/worker-deploy -- \
       delete \
       --verbose \
       --name "$WORKER"
```

## Contributing

We welcome contributions to this project! To get started, fork the repository
and create a new branch for your changes. When you're ready to submit your
changes, create a pull request.

Here's a list of planned tasks for the project:

- Add support for running as a Github Action
- Add support for email routing
- Add support for deploying and linking Durable Objects
- Add support for deploying, linking and initializing D1 DBs

Before submitting a pull request, please ensure that your code follows our code
style guidelines and that all tests pass. You can run tests with the command
`npm test`.

## License

This project is licensed under the
[MIT License](https://opensource.org/licenses/MIT).
