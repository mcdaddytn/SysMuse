package com.sysmuse.expr;

import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class StringOperations {

    public static void register(OperationRegistry registry) {

        registry.registerString("append",
                (Map<String, Object> args, Map<String, Object> ctx) ->
                        String.valueOf(args.get("a")) + String.valueOf(args.get("b")),
                List.of("a", "b"));

        registry.registerString("substring",
                (Map<String, Object> args, Map<String, Object> ctx) -> {
                    String s = String.valueOf(args.get("value"));
                    int start = Integer.parseInt(String.valueOf(args.get("start")));
                    int end = Integer.parseInt(String.valueOf(args.getOrDefault("end", s.length())));
                    return s.substring(start, Math.min(end, s.length()));
                },
                List.of("value", "start", "end"));

        registry.registerString("mid",
                (Map<String, Object> args, Map<String, Object> ctx) -> {
                    String s = String.valueOf(args.get("value"));
                    int start = Integer.parseInt(String.valueOf(args.get("start")));
                    int len = Integer.parseInt(String.valueOf(args.get("length")));
                    return s.substring(start, Math.min(start + len, s.length()));
                },
                List.of("value", "start", "length"));

        registry.registerString("removeExt",
                (Map<String, Object> args, Map<String, Object> ctx) -> {
                    String filename = String.valueOf(args.get("value"));
                    int lastDot = filename.lastIndexOf('.');
                    return (lastDot > 0) ? filename.substring(0, lastDot) : filename;
                },
                List.of("value"));

        registry.registerString("fileName",
                (Map<String, Object> args, Map<String, Object> ctx) -> {
                    String path = String.valueOf(args.get("value"));
                    return new File(path).getName();
                },
                List.of("value"));

        registry.registerString("pathOf",
                (Map<String, Object> args, Map<String, Object> ctx) -> {
                    String path = String.valueOf(args.get("value"));
                    return Optional.ofNullable(new File(path).getParent()).orElse("");
                },
                List.of("value"));

        registry.registerString("toUpper",
                (Map<String, Object> args, Map<String, Object> ctx) ->
                        String.valueOf(args.get("value")).toUpperCase(),
                List.of("value"));

        registry.registerString("toLower",
                (Map<String, Object> args, Map<String, Object> ctx) ->
                        String.valueOf(args.get("value")).toLowerCase(),
                List.of("value"));

        registry.registerString("trim",
                (Map<String, Object> args, Map<String, Object> ctx) ->
                        String.valueOf(args.get("value")).trim(),
                List.of("value"));

        registry.registerString("template",
                (Map<String, Object> args, Map<String, Object> ctx) -> {
                    String tmpl = String.valueOf(args.get("template"));
                    return TemplateFormatter.format(tmpl, ctx, "{", "}");
                },
                List.of("template"));
    }
}
