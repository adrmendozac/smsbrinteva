const X_ROBOTS_TAG = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

function registerCrawlerProtection(app) {
  app.use((req, res, next) => {
    res.set('X-Robots-Tag', X_ROBOTS_TAG);
    next();
  });

  app.get('/robots.txt', (req, res) => {
    res
      .type('text/plain')
      .send('User-agent: *\nDisallow: /\n');
  });
}

module.exports = {
  registerCrawlerProtection,
  X_ROBOTS_TAG,
};
