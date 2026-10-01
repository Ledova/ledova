# The local stack's chain-deploy service (docker-compose.yml): it checks the core contracts on the
# stack's chain and deploys them on a new one. Local development only; nothing deploys this image.
# Match the repository's validated Node/npm toolchain.
FROM node:22.15.1-alpine

RUN npm install -g npm@11.5.2

ENV HARDHAT_DISABLE_TELEMETRY_PROMPT=true

USER node
# deploy-all.ts also writes ../.deployed-contracts.env, so the parent directory must be writable.
WORKDIR /home/node/contracts

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .
# Compiling here keeps the solc download out of every start; `hardhat run` then finds nothing to compile.
RUN npx hardhat compile

CMD ["npm", "run", "deploy:local:stack"]
