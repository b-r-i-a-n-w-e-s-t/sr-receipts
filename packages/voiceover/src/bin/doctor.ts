#!/usr/bin/env node
/**
 * The doctor, from a terminal: `npx sr-voiceover-doctor` in a consuming
 * repository, or `npm run doctor` here. Its own file, with no check of how it
 * was started, because an installed bin runs through a symlink, so the module
 * that was started never has the bin's path.
 */
import { resolve } from "node:path";
import { inspect, writeDoctorReport } from "../doctor.ts";

const checks = inspect();
const report = resolve("doctor.json");
writeDoctorReport(checks, report);
for (const check of checks) {
  console.log(`${check.ok ? "OK" : "MISSING"} ${check.name}: ${check.actual}`);
}
console.log(`Wrote ${report}`);
if (!checks.every((check) => check.ok)) {
  console.log("This read-only check cannot prove Accessibility or Automation authorization.");
  process.exitCode = 1;
}
