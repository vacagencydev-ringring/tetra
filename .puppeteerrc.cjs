/** @type {import('puppeteer').Configuration} */
const { join } = require('path');
module.exports = {
  // Render: use persistent cache dir; local: use project .cache
  cacheDirectory: process.env.PUPPETEER_CACHE_DIR || join(__dirname, '.cache', 'puppeteer'),
};
