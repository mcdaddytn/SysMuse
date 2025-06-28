package com.sysmuse.expr;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiFunction;

public abstract class BaseOperation implements GenericOperation {

    private final Class<?> returnType;
    private final LinkedHashMap<String, Class<?>> expectedArgs;
    private final BiFunction<Map<String, Object>, Map<String, Object>, Object> implementation;

    protected BaseOperation(Class<?> returnType,
                            LinkedHashMap<String, Class<?>> expectedArgs,
                            BiFunction<Map<String, Object>, Map<String, Object>, Object> implementation) {
        this.returnType = returnType;
        this.expectedArgs = expectedArgs;
        this.implementation = implementation;
    }

    @Override
    public Class<?> getReturnType() {
        return returnType;
    }

    @Override
    public LinkedHashMap<String, Class<?>> getExpectedArgs() {
        return expectedArgs;
    }

    @Override
    public Object apply(Map<String, Object> args, Map<String, Object> context) {
        return implementation.apply(args, context);
    }
}

