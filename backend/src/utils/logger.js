const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logLevel || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'messenger-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    })
  ]
});

// Добавляем файловые логи
try {
  logger.add(new winston.transports.File({ 
    filename: '/var/log/app/error.log', 
    level: 'error',
    maxsize: 5242880,
    maxFiles: 5
  }));
  logger.add(new winston.transports.File({ 
    filename: '/var/log/app/combined.log',
    maxsize: 5242880,
    maxFiles: 5
  }));
} catch (err) {
  console.log('Could not create file transports, using console only');
}

module.exports = logger;
