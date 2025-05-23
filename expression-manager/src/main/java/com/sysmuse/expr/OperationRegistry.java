package com.sysmuse.expr;

import java.util.*;

public class OperationRegistry {

    private final Map<String, BooleanOperation> booleanOps = new HashMap<>();
    private final Map<String, StringOperation> stringOps = new HashMap<>();
    private final Map<String, NumericOperation> numericOps = new HashMap<>();
    private final Map<String, NumericOperation> numericOperators = new HashMap<>();
    private final Map<String, List<String>> argOrder = new HashMap<>();
    private final Map<String, String> aliases = new HashMap<>();

    public void registerBoolean(String name, BooleanOperation op, List<String> argNames, String... alternativeNames) {
        String key = name.toLowerCase();
        booleanOps.put(key, op);
        argOrder.put(key, argNames);
        for (String alias : alternativeNames) aliases.put(alias.toLowerCase(), key);
    }

    public void registerString(String name, StringOperation op, List<String> argNames, String... alternativeNames) {
        String key = name.toLowerCase();
        stringOps.put(key, op);
        argOrder.put(key, argNames);
        for (String alias : alternativeNames) aliases.put(alias.toLowerCase(), key);
    }

    public void registerNumeric(String name, NumericOperation op, List<String> argNames, String... alternativeNames) {
        String key = name.toLowerCase();
        numericOps.put(key, op);
        argOrder.put(key, argNames);
        for (String alias : alternativeNames) aliases.put(alias.toLowerCase(), key);
    }

    public void registerNumericOperator(String symbol, NumericOperation op, List<String> argNames) {
        numericOperators.put(symbol, op);
        argOrder.put(symbol, argNames);
    }

    public BooleanOperation getBoolean(String name) {
        return booleanOps.get(resolve(name));
    }

    public StringOperation getString(String name) {
        return stringOps.get(resolve(name));
    }

    public NumericOperation getNumeric(String name) {
        return numericOps.get(resolve(name));
    }

    public NumericOperation getNumericOperator(String symbol) {
        return numericOperators.get(symbol);
    }

    public List<String> getArgOrder(String name) {
        return argOrder.get(resolve(name));
    }

    public boolean contains(String name) {
        String resolved = resolve(name);
        return booleanOps.containsKey(resolved) ||
                stringOps.containsKey(resolved) ||
                numericOps.containsKey(resolved);
    }

    private String resolve(String name) {
        return aliases.getOrDefault(name.toLowerCase(), name.toLowerCase());
    }
}


