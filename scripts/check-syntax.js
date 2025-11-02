#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

const targets = [
  path.join(projectRoot, "netlify", "functions"),
  path.join(projectRoot, "service-worker.js"),
];

const discovered = [];

/**
 * Recursively walk directories and collect .js file paths, skipping node_modules.
 * @param {string} entry
 */
const walk = (entry) => {
  let stats;
  try {
    stats = fs.statSync(entry);
  } catch (error) {
    return;
  }

  if (stats.isDirectory()) {
    if (path.basename(entry) === "node_modules") {
      return;
    }
    const children = fs.readdirSync(entry);
    children.forEach((child) => walk(path.join(entry, child)));
    return;
  }

  if (stats.isFile() && path.extname(entry) === ".js") {
    discovered.push(entry);
  }
};

targets.forEach((target) => {
  if (!fs.existsSync(target)) {
    return;
  }
  walk(target);
});

if (discovered.length === 0) {
  console.log("No JavaScript files found to check.");
  process.exit(0);
}

const failures = [];

discovered.sort().forEach((filePath) => {
  const relativePath = path.relative(projectRoot, filePath) || path.basename(filePath);
  try {
    execFileSync("node", ["--check", filePath], { stdio: "pipe" });
    console.log(`✓ ${relativePath}`);
  } catch (error) {
    const output = (error.stderr && error.stderr.toString()) || error.message;
    failures.push({ file: relativePath, message: output.trim() });
    console.error(`✖ ${relativePath}`);
    if (output) {
      console.error(output.trim());
    }
  }
});

if (failures.length > 0) {
  console.error(`\nSyntax check failed for ${failures.length} file(s).`);
  process.exit(1);
}

console.log(`\nSyntax check passed for ${discovered.length} file(s).`);
