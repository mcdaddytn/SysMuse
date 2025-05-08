package com.sysmuse.util;

import java.io.FileOutputStream;
import java.io.PrintStream;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.logging.ConsoleHandler;
import java.util.logging.FileHandler;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.logging.SimpleFormatter;

/**
 * Utility class for centralized logging functionality in Conversion Hub.
 * Provides a wrapper around Java's logging framework with simpler interface.
 */
public class LoggingUtil {
    private static final Logger logger = Logger.getLogger("com.sysmuse.util");
    private static boolean initialized = false;
    private static Level currentLevel = Level.INFO;
    private static boolean consoleLogging = true;
    private static boolean fileLogging = false;
    private static String logFileName = "converter.log";

    /**
     * Initialize the logging system based on system configuration
     */
    public static void initialize(SystemConfig config) {
        if (initialized) {
            return;
        }

        // Set up logging configuration
        String levelStr = config.getLoggingLevel();
        boolean consoleEnabled = config.isConsoleLoggingEnabled();
        boolean fileEnabled = config.isFileLoggingEnabled();
        String fileName = config.getLogFileName();

        // Set logging level
        switch (levelStr.toUpperCase()) {
            case "SEVERE":
                currentLevel = Level.SEVERE;
                break;
            case "WARNING":
                currentLevel = Level.WARNING;
                break;
            case "DEBUG":
                currentLevel = Level.FINE;
                break;
            case "TRACE":
                currentLevel = Level.FINEST;
                break;
            default:
                currentLevel = Level.INFO;
        }

        // Remove existing handlers
        for (Handler handler : logger.getHandlers()) {
            logger.removeHandler(handler);
        }

        // Configure root logger
        Logger rootLogger = Logger.getLogger("");
        for (Handler handler : rootLogger.getHandlers()) {
            rootLogger.removeHandler(handler);
        }

        // Set up console handler if enabled
        if (consoleEnabled) {
            ConsoleHandler consoleHandler = new ConsoleHandler();
            consoleHandler.setLevel(currentLevel);
            logger.addHandler(consoleHandler);
            consoleLogging = true;
        }

        // Set up file handler if enabled
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

    /**
     * Initialize the logging system with basic configuration
     * Used primarily for backward compatibility
     */
    public static void initialize(String levelStr, boolean consoleEnabled, boolean fileEnabled, String fileName) {
        if (initialized) {
            return;
        }

        // Set logging level
        switch (levelStr.toUpperCase()) {
            case "SEVERE":
                currentLevel = Level.SEVERE;
                break;
            case "WARNING":
                currentLevel = Level.WARNING;
                break;
            case "DEBUG":
                currentLevel = Level.FINE;
                break;
            case "TRACE":
                currentLevel = Level.FINEST;
                break;
            default:
                currentLevel = Level.INFO;
        }

        // Configure root logger
        Logger rootLogger = Logger.getLogger("");
        for (Handler handler : rootLogger.getHandlers()) {
            rootLogger.removeHandler(handler);
        }

        // Set up console handler if enabled
        if (consoleEnabled) {
            ConsoleHandler consoleHandler = new ConsoleHandler();
            consoleHandler.setLevel(currentLevel);
            logger.addHandler(consoleHandler);
            consoleLogging = true;
        }

        // Set up file handler if enabled
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

    /**
     * Log a debug message
     */
    public static void debug(String message) {
        ensureInitialized();
        logger.fine(message);
    }

    /**
     * Log a debug message with a throwable
     */
    public static void debug(String message, Throwable t) {
        ensureInitialized();
        logger.log(Level.FINE, message, t);
    }

    /**
     * Log an info message
     */
    public static void info(String message) {
        ensureInitialized();
        logger.info(message);
    }

    /**
     * Log a warning message
     */
    public static void warn(String message) {
        ensureInitialized();
        logger.warning(message);
    }

    /**
     * Log a warning message with a throwable
     */
    public static void warn(String message, Throwable t) {
        ensureInitialized();
        logger.log(Level.WARNING, message, t);
    }

    /**
     * Log an error message
     */
    public static void error(String message) {
        ensureInitialized();
        logger.severe(message);
    }

    /**
     * Log an error message with a throwable
     */
    public static void error(String message, Throwable t) {
        ensureInitialized();
        logger.log(Level.SEVERE, message, t);
    }

    /**
     * Check if debug logging is enabled
     */
    public static boolean isDebugEnabled() {
        return currentLevel.intValue() <= Level.FINE.intValue();
    }

    /**
     * Ensure logger is initialized
     */
    private static void ensureInitialized() {
        if (!initialized) {
            // Default initialization
            initialize("INFO", true, false, "converter.log");
        }
    }
}
