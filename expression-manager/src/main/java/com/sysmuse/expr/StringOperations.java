package com.sysmuse.expr;

import java.io.File;
import java.util.*;

public class StringOperations {
    public static void register(OperationRegistry registry) {
        registry.registerString("append", (args, ctx) -> 
            String.valueOf(args.get("a")) + String.valueOf(args.get("b")),
            List.of("a", "b"));

        registry.registerString("substring", (args, ctx) -> {
            String s = String.valueOf(args.get("value"));
            int start = Integer.parseInt(String.valueOf(args.get("start")));
            int end = Integer.parseInt(String.valueOf(args.getOrDefault("end", s.length())));
            return s.substring(start, Math.min(end, s.length()));
        }, List.of("value", "start", "end"));

        registry.registerString("mid", (args, ctx) -> {
            String s = String.valueOf(args.get("value"));
            int start = Integer.parseInt(String.valueOf(args.get("start")));
            int len = Integer.parseInt(String.valueOf(args.get("length")));
            return s.substring(start, Math.min(start + len, s.length()));
        }, List.of("value", "start", "length"));

        registry.registerString("removeExt", (args, ctx) -> {
            String filename = String.valueOf(args.get("value"));
            int lastDot = filename.lastIndexOf('.');
            return lastDot > 0 ? filename.substring(0, lastDot) : filename;
        }, List.of("value"));

        registry.registerString("fileName", (args, ctx) -> {
            String path = String.valueOf(args.get("value"));
            return new File(path).getName();
        }, List.of("value"));

        registry.registerString("pathOf", (args, ctx) -> {
            String path = String.valueOf(args.get("value"));
            return Optional.ofNullable(new File(path).getParent()).orElse("");
        }, List.of("value"));

        registry.registerString("toUpper", (args, ctx) -> 
            String.valueOf(args.get("value")).toUpperCase(), 
            List.of("value"));

        registry.registerString("toLower", (args, ctx) -> 
            String.valueOf(args.get("value")).toLowerCase(), 
            List.of("value"));

        registry.registerString("trim", (args, ctx) -> 
            String.valueOf(args.get("value")).trim(), 
            List.of("value"));

        registry.registerString("template", (args, ctx) -> {
            String tmpl = String.valueOf(args.get("template"));
            String start = String.valueOf(args.getOrDefault("start", "{"));
            String end = String.valueOf(args.getOrDefault("end", "}"));
            return TemplateFormatter.format(tmpl, ctx, start, end);
        }, List.of("template", "start", "end"));
    }
}
