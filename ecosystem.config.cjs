/**
 * pm2 process list for the demo/preview box.
 *
 * Both apps read their own .env with dotenv from the CURRENT directory, so
 * `cwd` is load-bearing here - start them from anywhere else and they come up
 * with defaults and no database.
 */
module.exports = {
  apps: [
    {
      name: "suarza-server",
      cwd: "/opt/suarza/apps/server",
      script: "dist/index.js",
      interpreter: "node",
      node_args: "--max-old-space-size=320",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      autorestart: true,
      time: true,
    },
    {
      name: "suarza-agent",
      cwd: "/opt/suarza/apps/agent",
      script: "dist/index.js",
      interpreter: "node",
      node_args: "--max-old-space-size=256",
      env: { NODE_ENV: "production" },
      max_memory_restart: "320M",
      autorestart: true,
      time: true,
    },
  ],
};
