function createHttpLoggerMiddleware(logger) {
  return (req, res, next) => {
    const start = Date.now();

    logger.info('Incoming request', {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('Response sent', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`
      });
    });

    next();
  };
}

module.exports = createHttpLoggerMiddleware;
