package com.sysmuse.util;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;

public class DirectoryFlattener {

    public enum Mode {
        INCLUDE, // include only listed subdirs unless excluded
        EXCLUDE  // include all subdirs except listed subdirs
    }

    public static class Config {
        public String inputDir;
        public String outputDir;
        public Mode mode = Mode.INCLUDE;
        public List<SubdirRule> subdirs = new ArrayList<>();
        public List<SubdirRule> subdirs_inactive = new ArrayList<>();
        public boolean overwrite = false;
    }

    public static class SubdirRule {
        public String name;
        public List<String> excludeFiles = new ArrayList<>();
    }

    public static void main(String[] args) throws Exception {
        Path configFilePath = null;

        if (args.length != 1) {
        /*
            System.err.println("Usage: java DirectoryFlattener config.json");
            System.exit(1);
         */
            configFilePath = Paths.get("F:\\data\\config\\DirectoryFlattener.json");
        }
        else {
            configFilePath = Paths.get(args[0]);
        }

        ObjectMapper mapper = new ObjectMapper();
        Config config = mapper.readValue(configFilePath.toFile(), Config.class);

        flatten(config);
    }

    public static void flatten(Config config) throws IOException {
        Path inputRoot = Paths.get(config.inputDir).toAbsolutePath().normalize();
        Path outputRoot = Paths.get(config.outputDir).toAbsolutePath().normalize();

        Files.createDirectories(outputRoot);

        Map<String, SubdirRule> ruleByName = new HashMap<>();
        for (SubdirRule rule : config.subdirs) {
            ruleByName.put(rule.name, rule);
        }

        try (DirectoryStream<Path> subdirs = Files.newDirectoryStream(inputRoot)) {
            for (Path subdir : subdirs) {
                if (!Files.isDirectory(subdir)) {
                    continue;
                }

                String subdirName = subdir.getFileName().toString();

                if (!shouldIncludeSubdir(config.mode, subdirName, ruleByName)) {
                    continue;
                }

                SubdirRule rule = ruleByName.getOrDefault(subdirName, new SubdirRule());
                Set<String> excludedFiles = new HashSet<>(rule.excludeFiles);

                copyFilesFromSubdir(subdir, outputRoot, subdirName, excludedFiles, config.overwrite);
            }
        }
    }

    private static boolean shouldIncludeSubdir(
            Mode mode,
            String subdirName,
            Map<String, SubdirRule> ruleByName
    ) {
        boolean listed = ruleByName.containsKey(subdirName);

        return switch (mode) {
            case INCLUDE -> listed;
            case EXCLUDE -> !listed;
        };
    }

    private static void copyFilesFromSubdir(
            Path subdir,
            Path outputRoot,
            String subdirName,
            Set<String> excludedFiles,
            boolean overwrite
    ) throws IOException {

        try (DirectoryStream<Path> files = Files.newDirectoryStream(subdir)) {
            for (Path file : files) {
                if (!Files.isRegularFile(file)) {
                    continue;
                }

                String originalFileName = file.getFileName().toString();

                if (excludedFiles.contains(originalFileName)) {
                    continue;
                }

                String flattenedFileName = ensurePrefix(subdirName, originalFileName);
                Path target = outputRoot.resolve(flattenedFileName);

                if (Files.exists(target) && !overwrite) {
                    throw new IOException("Target file already exists: " + target);
                }

                CopyOption[] options = overwrite
                        ? new CopyOption[]{StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES}
                        : new CopyOption[]{StandardCopyOption.COPY_ATTRIBUTES};

                Files.copy(file, target, options);

                System.out.println("Copied: " + file + " -> " + target);
            }
        }
    }

    private static String ensurePrefix(String subdirName, String fileName) {
        String requiredPrefix = subdirName + "-";

        if (fileName.startsWith(requiredPrefix)) {
            return fileName;
        }

        return requiredPrefix + fileName;
    }
}
