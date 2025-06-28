package com.sysmuse.expr;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

public class StringBaseOperation extends BaseOperation implements StringOperation {

    public StringBaseOperation(List<String> argNames,
                               BiFunction<Map<String, Object>, Map<String, Object>, Object> implementation) {
        super(String.class, toArgTypes(argNames), implementation);
    }

    private static LinkedHashMap<String, Class<?>> toArgTypes(List<String> names) {
        LinkedHashMap<String, Class<?>> types = new LinkedHashMap<>();
        for (String name : names) types.put(name, Object.class);
        return types;
    }
}

