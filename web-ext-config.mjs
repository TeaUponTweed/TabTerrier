// Keep the packaged XPI to just the extension: no toolchain, no repo metadata.
export default {
  ignoreFiles: [
    "tools",
    "tools/**",
    "web-ext-config.mjs",
    ".gitignore",
    "README.md",
  ],
};
