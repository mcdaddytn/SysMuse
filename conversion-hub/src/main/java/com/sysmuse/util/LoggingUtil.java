package com.sysmuse.util;

import java.io.IOException;
import java.util.logging.*;

/**
 * Utility class for centralized logging functionality in Conversion Hub.
 * Provides a wrapper around Java's logging framework with simpler interface.
 */
public class LoggingUtil {
    public enum ConsoleOutputMode {
        ALL_TO_OUT,
        ALL_TO_ERR,
        SPLIT_SEVERE_TO_ERR
    }

    private static final Logger logger = Logger.getLogger("com.sysmuse.util");
    private static boolean initialized = false;
    private static Level currentLevel = Level.INFO;
    //private static Level currentLevel = Level.DEBUG;
    private static boolean consoleLogging = true;
    private static boolean fileLogging = false;
    private static String logFileName = "converter.log";
    private static ConsoleOutputMode consoleOutputMode = ConsoleOutputMode.SPLIT_SEVERE_TO_ERR;
    private static boolean debugToInfo = false;
    //private static boolean debugToInfo = true;

    // Console Handlers
    private static class StdOutHandler extends StreamHandler {
        public StdOutHandler(Level level) {
            super(System.out, new SimpleFormatter());
            setLevel(level);
        }

        @Override
        public synchronized void publish(LogRecord record) {
            super.publish(record);
            flush();
        }
    }

    private static class StdErrHandler extends StreamHandler {
        public StdErrHandler(Level level) {
            super(System.err, new SimpleFormatter());
            setLevel(level);
        }

        @Override
        public synchronized void publish(LogRecord record) {
            super.publish(record);
            flush();
        }
    }

    public static void setDebugToInfo(Boolean dti) {
        debugToInfo = dti;
    }

    /**
     * Configure where log messages go in console
     */
    public static void setConsoleOutputMode(ConsoleOutputMode mode) {
        consoleOutputMode = mode;
    }

    /**
     * Initialize the logging system based on system configuration
     */
    /*
    public static void initialize(SystemConfig config) {
        initialize(config.getLoggingLevel(), config.isConsoleLoggingEnabled(), config.isFileLoggingEnabled(), config.getLogFileName());
    }
     */

    /**
     * Alternate initializer (backward compatible)
     */
    public static void initialize(String levelStr, boolean consoleEnabled, boolean fileEnabled, String fileName) {
        if (initialized) {
            return;
        }

        setLoggingLevel(levelStr);

        clearHandlers();

        if (consoleEnabled) {
            setupConsoleHandlers();
        }

        if (fileEnabled && fileName != null && !fileName.isEmpty()) {
            try {
                FileHandler fileHandler = new FileHandler(fileName);
                fileHandler.setFormatter(new SimpleFormatter());
                fileHandler.setLevel(currentLevel);
                logger.addHandler(fileHandler);
                fileLogging = true;
                logFileName = fileName;
            } catch (IOException e) {
                error("Failed to create log file: " + e.getMessage());
                fileLogging = false;
            }
        }

        logger.setLevel(currentLevel);
        logger.setUseParentHandlers(false);
        initialized = true;

        info("Logging initialized: level=" + currentLevel +
                ", console=" + consoleLogging +
                ", file=" + (fileLogging ? logFileName : "disabled"));
    }

    private static void setLoggingLevel(String levelStr) {
        switch (levelStr.toUpperCase()) {
            case "SEVERE": currentLevel = Level.SEVERE; break;
            case "WARNING": currentLevel = Level.WARNING; break;
            case "DEBUG": currentLevel = Level.FINE; break;
            case "TRACE": currentLevel = Level.FINEST; break;
            default: currentLevel = Level.INFO;
        }
    }

    private static void clearHandlers() {
        Logger rootLogger = Logger.getLogger("");
        for (Handler handler : rootLogger.getHandlers()) {
            rootLogger.removeHandler(handler);
        }
        for (Handler handler : logger.getHandlers()) {
            logger.removeHandler(handler);
        }
    }

    private static void setupConsoleHandlers() {
        switch (consoleOutputMode) {
            case ALL_TO_OUT:
                logger.addHandler(new StdOutHandler(currentLevel));
                break;
            case ALL_TO_ERR:
                logger.addHandler(new StdErrHandler(currentLevel));
                break;
            case SPLIT_SEVERE_TO_ERR:
                logger.addHandler(new StdOutHandler(currentLevel));
                logger.addHandler(new StdErrHandler(Level.SEVERE));
                break;
        }
        consoleLogging = true;
    }

    public static void debug(String message) {
        ensureInitialized();
        if (debugToInfo)
            logger.info(message);
        else
            logger.fine(message);
    }

    public static void debug(String message, Throwable t) {
        ensureInitialized();
        if (debugToInfo)
            logger.log(Level.INFO, message, t);
        else
            logger.log(Level.FINE, message, t);
    }

    public static void info(String message) {
        ensureInitialized();
        logger.info(message);
    }

    public static void warn(String message) {
        ensureInitialized();
        logger.warning(message);
    }

    public static void warn(String message, Throwable t) {
        ensureInitialized();
        logger.log(Level.WARNING, message, t);
    }

    public static void error(String message) {
        ensureInitialized();
        logger.severe(message);
    }

    public static void error(String message, Throwable t) {
        ensureInitialized();
        logger.log(Level.SEVERE, message, t);
    }


    public static void debug(String format, Object... args) {
        debug(String.format(format, args));
    }

    public static void debug(String format, Throwable t, Object... args) {
        debug(String.format(format, args), t);
    }

    public static void info(String format, Object... args) {
        info(String.format(format, args));
    }

    public static void warn(String format, Object... args) {
        warn(String.format(format, args));
    }

    public static void warn(String format, Throwable t, Object... args) {
        warn(String.format(format, args), t);
    }

    public static void error(String format, Object... args) {
        error(String.format(format, args));
    }

    public static void error(String format, Throwable t, Object... args) {
        error(String.format(format, args), t);
    }

    public static boolean isDebugEnabled() {
        return currentLevel.intValue() <= Level.FINE.intValue();
    }

    private static void ensureInitialized() {
        if (!initialized) {
            initialize("INFO", true, false, "converter.log");
        }
    }
}
