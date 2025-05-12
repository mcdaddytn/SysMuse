package com.sysmuse.expr;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

public class NumericBaseOperation extends BaseOperation implements NumericOperation {

    public NumericBaseOperation(Class<?> returnType,
                                List<String> argNames,
                                BiFunction<Map<String, Object>, Map<String, Object>, Object> implementation) {
        super(returnType, toArgTypes(argNames, Double.class), implementation);
    }

    private static LinkedHashMap<String, Class<?>> toArgTypes(List<String> names, Class<?> clazz) {
        LinkedHashMap<String, Class<?>> types = new LinkedHashMap<>();
        for (String name : names) types.put(name, clazz);
        return types;
    }
}
