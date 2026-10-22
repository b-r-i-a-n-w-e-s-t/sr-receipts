/**
 * The Receipt File: the part of a Receipt a person reads and a repository can
 * keep. One Markdown file per test per reader project, beside the spec the way
 * Playwright keeps snapshots, and replaced by every run. Nothing in it changes
 * unless the run did, so a change to the file is a change in what the reader
 * said, what the page was doing, or what produced it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { SILENCE, type Reader, type Step } from "@sr-receipts/host";

const NAMES: Record<Reader, string> = { nvda: "NVDA", voiceover: "VoiceOver" };

/** What the Receipt File needs from Playwright's `testInfo`. */
export interface ReceiptTestInfo {
  /** The spec's absolute path. */
  file: string;
  line: number;
  /** The spec's path, then each `describe`, then the test's own title. */
  titlePath: string[];
  project: { name: string };
  retry: number;
  config: { rootDir: string };
}

export interface ReceiptFileContent {
  reader: Reader;
  outcome: string;
  environment: string[];
  steps: Step[];
  transcript: string[];
}

/** `<spec>-receipts/<describe and test titles>--<project>.md`. */
export function receiptFilePath(testInfo: ReceiptTestInfo): string {
  const slug = testInfo.titlePath
    .slice(1)
    .join(" ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const project = testInfo.project.name ? `--${testInfo.project.name.replace(/[^A-Za-z0-9]+/g, "-")}` : "";
  return join(`${testInfo.file}-receipts`, `${slug}${project}.md`);
}

/** One table cell: a pipe would end it and a newline would end the row. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ");
}

function said(step: Step): string {
  if (step.error !== undefined) return `failed: ${step.error}`;
  return step.spoken || SILENCE;
}

/**
 * The page state's columns, in the order a Step first named them. A read
 * that failed on every Step still gets a column, to say so.
 */
function stateColumns(steps: Step[]): string[] {
  const columns = [...new Set(steps.flatMap((step) => Object.keys(step.state ?? {})))];
  return columns.length === 0 && steps.some((step) => step.stateError !== undefined) ? ["State after"] : columns;
}

function stateCell(step: Step, column: string): string {
  if (step.stateError !== undefined) return `(state failed: ${step.stateError})`;
  const value = step.state?.[column];
  if (value === undefined) return "";
  return value || "(empty)";
}

function stepsTable(steps: Step[]): string[] {
  if (steps.length === 0) return ["The test made no calls to the reader."];
  const columns = stateColumns(steps);
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [
    row(["#", "Call", "Reader said", ...columns]),
    row(["#", "Call", "Reader said", ...columns].map(() => "---")),
    ...steps.map((step, index) => row([String(index + 1), step.call, said(step), ...columns.map((column) => stateCell(step, column))].map(cell))),
  ];
}

export function renderReceiptFile(testInfo: ReceiptTestInfo, content: ReceiptFileContent): string {
  const outcome = testInfo.retry > 0 ? `${content.outcome}, on retry ${testInfo.retry}` : content.outcome;
  const spec = relative(testInfo.config.rootDir, testInfo.file).split("\\").join("/");
  return [
    `# ${testInfo.titlePath.slice(1).join(" › ")}`,
    "",
    `Reader: ${NAMES[content.reader]}, project \`${testInfo.project.name}\``,
    `Outcome: ${outcome}`,
    `Spec: \`${spec}:${testInfo.line}\``,
    "",
    "## Environment",
    "",
    "```",
    ...content.environment,
    "```",
    "",
    "## Steps",
    "",
    ...stepsTable(content.steps),
    "",
    "## Transcript",
    "",
    "```",
    ...content.transcript,
    "```",
    "",
  ].join("\n");
}

/** Write the test's Receipt File, replacing the last run's. */
export function writeReceiptFile(testInfo: ReceiptTestInfo, content: ReceiptFileContent): void {
  const path = receiptFilePath(testInfo);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderReceiptFile(testInfo, content));
}
