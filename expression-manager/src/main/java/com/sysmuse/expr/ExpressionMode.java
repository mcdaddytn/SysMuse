package com.sysmuse.expr;

/**
 * Describes the syntax mode of the expression language:
 * FUNCTIONAL: operations written as functions like add(a, b)
 * OPERATIONAL: operations written in infix form like a + b
 */
public enum ExpressionMode {
    FUNCTIONAL,
    OPERATIONAL
}
