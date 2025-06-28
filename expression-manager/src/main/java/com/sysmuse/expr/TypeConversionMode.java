package com.sysmuse.expr;

public enum TypeConversionMode {
    NONE,        // no conversions allowed
    LOSSLESS,    // only lossless conversions allowed
    ANY          // allow any valid Java type coercion
}
