// PM2 process file for the DigitalOcean Droplet:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    { name: "bigstocks-web", script: "node_modules/next/dist/bin/next", args: "start -p 3000", env: { NODE_ENV: "production" } },
    { name: "bigstocks-ingest", script: "npm", args: "run ingest", env: { NODE_ENV: "production" } },
  ],
};
