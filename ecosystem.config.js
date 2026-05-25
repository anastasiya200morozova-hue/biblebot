module.exports = {
  apps: [{
    name: 'biblebot',
    script: 'dist/bot/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: { NODE_ENV: 'production' }
  }]
};
