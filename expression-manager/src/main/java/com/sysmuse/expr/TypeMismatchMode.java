package com.sysmuse.expr;

/**
 * Defines how ExpressionManager handles type mismatches
 * during evaluation of operations.
 */
public enum TypeMismatchMode {
    /**
     * Throw an exception on mismatched types.
     */
    EXCEPTION,

    /**
     * Log a warning but continue.
     */
    WARNING,

    /**
     * Attempt automatic type conversion if possible.
     */
    ACCEPT
}
