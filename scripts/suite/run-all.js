/**
 * run-all.js
 * --------------------------------------------------------
 * Runs the entire sanitation suite in correct order.
 */

const { execSync } = require("child_process");

const scripts = [
  "sanitize.blobs",
  "sanitize.users",
  "sanitize.athletes",
  "sanitize.donations",
  "sanitize.coaches"
];

function run(script) {
  console.log(`
====================================
 RUNNING: ${script}
====================================
  `);

  execSync(`node ${script}.js`, {
    stdio: "inherit",
    cwd: __dirname
  });
}

function main() {
  console.log("🔥 Starting FULL DATABASE SANITATION SUITE…");

  for (const s of scripts) run(s);

  console.log("🎉 All sanitation tasks complete!");
}

main();
