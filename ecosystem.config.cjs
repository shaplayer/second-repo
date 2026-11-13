// PM2 process file for the DigitalOcean Droplet:  pm2 start ecosystem.config.cjs
// Both processes read the .env file in this folder (never committed).
module.exports = {
  apps: [
    {
      name: "bigstocks-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1", // only Nginx talks to it
      env: { NODE_ENV: "production" },
      max_memory_restart: "700M",
    },
    {
      // The always-on worker: SEC filings, press releases, summaries, alert emails, nightly health checks.
      name: "bigstocks-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/worker.ts",
      env: { NODE_ENV: "production" },
      kill_timeout: 30000, // let it finish the email batch it is sending
      max_memory_restart: "700M",
      exp_backoff_restart_delay: 2000,
    },
  ],
};
