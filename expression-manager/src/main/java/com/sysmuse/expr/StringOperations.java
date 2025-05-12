package com.sysmuse.expr;

import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class StringOperations {

    public static void register(OperationRegistry registry) {
        registry.registerString("append",
                new StringBaseOperation(List.of("a", "b"),
                        (args, ctx) -> String.valueOf(args.get("a")) + String.valueOf(args.get("b"))),
                List.of("a", "b"));

        registry.registerString("substring",
                new StringBaseOperation(List.of("value", "start", "end"),
                        (args, ctx) -> {
                            String s = String.valueOf(args.get("value"));
                            int start = Integer.parseInt(String.valueOf(args.get("start")));
                            int end = Integer.parseInt(String.valueOf(args.getOrDefault("end", s.length())));
                            return s.substring(start, Math.min(end, s.length()));
                        }),
                List.of("value", "start", "end"));

        registry.registerString("mid",
                new StringBaseOperation(List.of("value", "start", "length"),
                        (args, ctx) -> {
                            String s = String.valueOf(args.get("value"));
                            int start = Integer.parseInt(String.valueOf(args.get("start")));
                            int len = Integer.parseInt(String.valueOf(args.get("length")));
                            return s.substring(start, Math.min(start + len, s.length()));
                        }),
                List.of("value", "start", "length"));

        registry.registerString("removeExt",
                new StringBaseOperation(List.of("value"),
                        (args, ctx) -> {
                            String filename = String.valueOf(args.get("value"));
                            int lastDot = filename.lastIndexOf('.');
                            return (lastDot > 0) ? filename.substring(0, lastDot) : filename;
                        }),
                List.of("value"));

        registry.registerString("fileName",
                new StringBaseOperation(List.of("value"),
                        (args, ctx) -> {
                            String path = String.valueOf(args.get("value"));
                            return new File(path).getName();
                        }),
                List.of("value"));

        registry.registerString("pathOf",
                new StringBaseOperation(List.of("value"),
                        (args, ctx) -> {
                            String path = String.valueOf(args.get("value"));
                            return Optional.ofNullable(new File(path).getParent()).orElse("");
                        }),
                List.of("value"));

        registry.registerString("toUpper",
                new StringBaseOperation(List.of("value"),
                        (args, ctx) -> String.valueOf(args.get("value")).toUpperCase()),
                List.of("value"));

        registry.registerString("toLower",
                new StringBaseOperation(List.of("value"),
                        (args, ctx) -> String.valueOf(args.get("value")).toLowerCase()),
                List.of("value"));

        registry.registerString("trim",
                new StringBaseOperation(List.of("value"),
                        (args, ctx) -> String.valueOf(args.get("value")).trim()),
                List.of("value"));

        registry.registerString("template",
                new StringBaseOperation(List.of("template"),
                        (args, ctx) -> TemplateFormatter.format(String.valueOf(args.get("template")), ctx, "{", "}")),
                List.of("template"));
    }
}
