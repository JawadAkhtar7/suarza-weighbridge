/**
 * Installs the weighbridge agent as a Windows service (brief §13-M8).
 *
 * A service, not a tray app or a shortcut: the weighbridge PC is switched on
 * by whoever opens the yard, and the software has to be running before anyone
 * thinks about it. As a service it starts at boot, before login, and restarts
 * itself if it ever exits.
 *
 * Run from an ADMINISTRATOR command prompt:
 *   node windows\install-service.cjs
 *
 * CommonJS on purpose — node-windows is CJS and this script is run directly by
 * an administrator rather than through the build.
 */

const path = require('node:path');
const fs = require('node:fs');

const { Service } = require('node-windows');

const agentRoot = path.resolve(__dirname, '..');
const entryPoint = path.join(agentRoot, 'dist', 'index.js');

if (!fs.existsSync(entryPoint)) {
  console.error(`Cannot find ${entryPoint}.\nBuild the agent first:  pnpm --filter @suarza/agent build`);
  process.exit(1);
}

if (!fs.existsSync(path.join(agentRoot, '.env'))) {
  console.error(
    `No .env found in ${agentRoot}.\n` +
      'Copy .env.example to .env and fill it in before installing the service.',
  );
  process.exit(1);
}

const service = new Service({
  name: 'Suarza Weighbridge Agent',
  description:
    'Reads the weight indicator, records weighments locally, serves the operator app and syncs to the cloud.',
  script: entryPoint,
  // The working directory decides where a relative DATABASE_PATH lands.
  workingDirectory: agentRoot,
  nodeOptions: ['--enable-source-maps'],
  // Restart rather than give up: a crash at 6am must not mean a yard full of
  // trucks and nobody able to weigh them.
  wait: 2,
  grow: 0.25,
  maxRestarts: 40,
});

service.on('install', () => {
  console.log('Service installed. Starting…');
  service.start();
});

service.on('alreadyinstalled', () => {
  console.log('Service is already installed. Run uninstall-service.cjs first to reinstall.');
});

service.on('start', () => {
  console.log('Suarza Weighbridge Agent is running.');
  console.log('The operator app is at http://localhost:3100 (or the PORT set in .env).');
  console.log('It will now start automatically whenever this PC boots.');
});

service.on('error', (error) => {
  console.error('Service error:', error);
});

service.install();
