/**
 * @fileoverview log4js is a library to log in JavaScript in similar manner
 * than in log4j for Java (but not really).
 *
 * <h3>Example:</h3>
 * <pre>
 *  const logging = require('log4js');
 *  const log = logging.getLogger('some-category');
 *
 *  //call the log
 *  log.trace('trace me' );
 * </pre>
 *
 * NOTE: the authors below are the original browser-based log4js authors
 * don't try to contact them about bugs in this version :)
 * @author Stephan Strittmatter - http://jroller.com/page/stritti
 * @author Seth Chisamore - http://www.chisamore.com
 * @since 2005-05-20
 * Website: http://log4js.berlios.de
 */
const debug = require("debug")("log4js:main");
const fs = require("fs");
const deepClone = require("rfdc")({ proto: true });
const configuration = require("./configuration");
const layouts = require("./layouts");
const levels = require("./levels");
const appenders = require("./appenders");
const categories = require("./categories");
const Logger = require("./logger");
const clustering = require("./clustering");
const connectLogger = require("./connect-logger");

let enabled = false;

function sendLogEventToAppender(logEvent) {
  if (!enabled) return;
  debug("Received log event ", logEvent);
  const categoryAppenders = categories.appendersForCategory(
    logEvent.categoryName
  );
  categoryAppenders.forEach(appender => {
    appender(logEvent);
  });
}

function loadConfigurationFile(filename) {
  debug(`Loading configuration from ${filename}`);
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (e) {
    throw new Error(
      `Problem reading config from file "${filename}". Error was ${e.message}`,
      e
    );
  }
}

function configure(configurationFileOrObject) {
  let configObject = configurationFileOrObject;

  if (typeof configObject === "string") {
    configObject = loadConfigurationFile(configurationFileOrObject);
  }
  debug(`Configuration is ${configObject}`);

  configuration.configure(deepClone(configObject));

  clustering.onMessage(sendLogEventToAppender);

  enabled = true;

  // eslint-disable-next-line no-use-before-define
  return log4js;
}

/**
 * Shutdown all log appenders. This will first disable all writing to appenders
 * and then call the shutdown function each appender.
 *
 * @params {Function} cb - The callback to be invoked once all appenders have
 *  shutdown. If an error occurs, the callback will be given the error object
 *  as the first argument.
 */
function shutdown(cb) {
  debug("Shutdown called. Disabling all log writing.");
  // First, disable all writing to appenders. This prevents appenders from
  // not being able to be drained because of run-away log writes.
  enabled = false;

  // Call each of the shutdown functions in parallel
  const appendersToCheck = Array.from(appenders.values());
  const shutdownFunctions = appendersToCheck.reduceRight(
    (accum, next) => (next.shutdown ? accum + 1 : accum),
    0
  );
  let completed = 0;
  let error;

  debug(`Found ${shutdownFunctions} appenders with shutdown functions.`);
  function complete(err) {
    error = error || err;
    completed += 1;
    debug(`Appender shutdowns complete: ${completed} / ${shutdownFunctions}`);
    if (completed >= shutdownFunctions) {
      debug("All shutdown functions completed.");
      cb(error);
    }
  }

  if (shutdownFunctions === 0) {
    debug("No appenders with shutdown functions found.");
    return cb();
  }

  appendersToCheck.filter(a => a.shutdown).forEach(a => a.shutdown(complete));

  return null;
}

/**
 * Get a logger instance.
 * @static
 * @param loggerCategoryName
 * @return {Logger} instance of logger for the category
 */
function getLogger(category) {
  if (!enabled) {
    configure(
      process.env.LOG4JS_CONFIG || {
        appenders: { out: { type: "stdout" } },
        categories: { default: { appenders: ["out"], level: "OFF" } }
      }
    );
  }
  return new Logger(category || "default");
}

/**
 * Get a appender instance.
 * @static
 * @param appenderName
 * @return {Appender} instance of appender
 */
function getAppender(name) {
  return appenders.get(name);
}

/**
 * Get a category instance.
 * @static
 * @param loggerCategoryName
 * @return {Appender} instance of category
 */
function getCategory(name) {
  return categories.hasCategory(name);
}

/**
 * shutdown a category.
 * @static
 * @param loggerCategoryName
 */
function shutdownCategory (categoryName, cb) {
  const category = categories.getCategory(categoryName);
  if (category) {
    if (category === 'default' && category.getCategoryValues().length == 1) {
      shutdown(cb);
    } else {
      categories.deleteCategory(categoryName)
      // Check if the appenders is used by other categories
      const categoriesToCheck = Array.from(categories.getCategoryValues())
      const appendersInuse = new Set()
      categoriesToCheck.forEach((element) => {
        element.appenderNames.forEach((appender) => {
          if (!appendersInuse.has(appender) &&
              category.appenderNames.includes(appender)) {
            appendersInuse.add(appender)
          }
        })
      })
      // Nothing to do if all appenders are used by other categories.
      if (appendersInuse.size === category.appenders.length) {
        return
      }
      // Call each of the shutdown functions in parallel
      const unsuedAppenderNames =
        category.appenderNames.filter(element => !appendersInuse.has(element));
      const unusedAppenders =
        unsuedAppenderNames.map((element) => appenders.get(element));
      const appendersToCheck = Array.from(unusedAppenders);
      const shutdownFunctions = appendersToCheck.reduceRight(
        (accum, next) => (next.shutdown ? accum + 1 : accum),
        0
      );
      let completed = 0;
      let error;

      debug(`Found ${shutdownFunctions} appenders with shutdown functions.`);
      function complete(err) {
        error = error || err;
        completed += 1;
        debug(`Appender shutdowns complete: ${completed} / ${shutdownFunctions}`);
        if (completed >= shutdownFunctions) {
          debug("All shutdown functions completed.");
          cb(error);
        }
      }

      unsuedAppenderNames.forEach((element) => {
        appenders.delete(element)
      })
      if (shutdownFunctions === 0) {
        debug("No appenders with shutdown functions found.");
        return cb();
      }

      appendersToCheck.filter(a => a.shutdown).forEach(a => a.shutdown(complete));
    }
  }
}

/**
 * @name log4js
 * @namespace Log4js
 * @property getLogger
 * @property configure
 * @property shutdown
 */
const log4js = {
  getLogger,
  getCategory,
  configure,
  shutdown,
  shutdownCategory,
  connectLogger,
  levels,
  addLayout: layouts.addLayout
};

module.exports = log4js;
