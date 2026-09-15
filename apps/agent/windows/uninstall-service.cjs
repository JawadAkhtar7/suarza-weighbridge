/**
 * Removes the Windows service. Run from an ADMINISTRATOR command prompt:
 *   node windows\uninstall-service.cjs
 *
 * The SQLite database and its backups are NOT touched — uninstalling the
 * service must never destroy weighment records.
 */

const path = require('node:path');
const { Service } = require('node-windows');

const service = new Service({
  name: 'Suarza Weighbridge Agent',
  script: path.join(path.resolve(__dirname, '..'), 'dist', 'index.js'),
});

service.on('uninstall', () => {
  console.log('Service uninstalled.');
  console.log('Your weighment database and backups have been left in place.');
});

service.on('doesnotexist', () => console.log('That service is not installed.'));

service.uninstall();
