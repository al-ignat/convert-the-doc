#!/usr/bin/env bun

import { resolve } from "path";
import { statSync, mkdirSync } from "fs";
import { convertFile, type OutputFormat } from "./convert";
import { writeOutput } from "./output";
import { buildPlan, ValidationError } from "./validate";
import { runInteractive } from "./interactive";

const VALID_FORMATS = new Set(["md", "json", "yaml", "docx", "pptx", "html"]);

function parseArgs(argv: string[]) {
  // Bun.argv: [bun, script, ...args]
  const args = argv.slice(2);
  let input: string | null = null;
  let format: OutputFormat = "md";
  let output: string | null = null;
  let formatExplicit = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-f" || arg === "--format") {
      const val = args[++i];
      if (!val || !VALID_FORMATS.has(val)) {
        console.error(`Invalid format: ${val ?? "(empty)"}. Use: md, json, yaml, docx, pptx, html`);
        process.exit(1);
      }
      format = val as OutputFormat;
      formatExplicit = true;
    } else if (arg === "-o" || arg === "--output") {
      output = args[++i];
      if (!output) {
        console.error("Missing output path.");
        process.exit(1);
      }
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      input = arg;
    }
  }

  return { input, format, output, formatExplicit };
}

function printHelp() {
  console.log(`
con-the-doc — Convert documents to LLM-friendly text

Usage:
  con-the-doc                          Interactive mode
  con-the-doc <file>                   Convert a file to .md
  con-the-doc <folder>                 Convert all files in folder
  con-the-doc <file> -f json -o ./out  Convert with options

  Outbound (Markdown → documents, requires Pandoc):
  con-the-doc notes.md -f docx         Convert .md to Word
  con-the-doc notes.md -f pptx         Convert .md to PowerPoint
  con-the-doc notes.md -f html         Convert .md to HTML

Options:
  -f, --format <fmt>   Output format (default: md)
                        Inbound:  md, json, yaml
                        Outbound: docx, pptx, html (requires Pandoc)
  -o, --output <path>  Output directory
  -h, --help           Show this help
`);
}

async function main() {
  const { input, format, output, formatExplicit } = parseArgs(Bun.argv);

  if (!input) {
    await runInteractive();
    return;
  }

  const resolvedInput = resolve(input);
  let stat;
  try {
    stat = statSync(resolvedInput);
  } catch {
    console.error(`Not found: ${input}`);
    process.exit(1);
  }

  const outputDir = output ? resolve(output) : undefined;
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
  }

  if (stat.isFile()) {
    await convertSingleFile(resolvedInput, format, outputDir, formatExplicit);
  } else if (stat.isDirectory()) {
    await convertFolder(resolvedInput, format, outputDir, formatExplicit);
  } else {
    console.error(`Not a file or folder: ${input}`);
    process.exit(1);
  }
}

async function convertSingleFile(
  filePath: string,
  format: OutputFormat,
  outputDir?: string,
  formatExplicit?: boolean
) {
  let plan;
  try {
    plan = buildPlan(filePath, format, { outputDir, formatExplicit });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  try {
    if (plan.direction === "outbound") {
      const result = await convertFile(filePath, plan.format, {
        outputDir,
        pandocArgs: plan.pandocArgs,
      });
      console.log(`✓ ${filePath} → ${result.outputPath}`);
    } else {
      const result = await convertFile(filePath, plan.format);
      await writeOutput(plan.outputPath, result.formatted);
      console.log(`✓ ${filePath} → ${plan.outputPath}`);
    }
  } catch (err: any) {
    console.error(`✗ ${filePath}: ${err.message ?? err}`);
    process.exit(1);
  }
}

async function convertFolder(
  dir: string,
  format: OutputFormat,
  outputDir?: string,
  formatExplicit?: boolean
) {
  const { readdirSync } = await import("fs");
  const { join } = await import("path");

  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => join(dir, e.name));

  if (files.length === 0) {
    console.log("No files found.");
    return;
  }

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  for (const file of files) {
    let plan;
    try {
      plan = buildPlan(file, format, { outputDir, formatExplicit });
    } catch (err: any) {
      if (err instanceof ValidationError) {
        console.log(`⊘ ${file}: ${err.message}`);
        skipped++;
        continue;
      }
      throw err;
    }

    try {
      if (plan.direction === "outbound") {
        const result = await convertFile(file, plan.format, {
          outputDir,
          pandocArgs: plan.pandocArgs,
        });
        console.log(`✓ ${file} → ${result.outputPath}`);
      } else {
        const result = await convertFile(file, plan.format);
        await writeOutput(plan.outputPath, result.formatted);
        console.log(`✓ ${file} → ${plan.outputPath}`);
      }
      ok++;
    } catch (err: any) {
      console.error(`✗ ${file}: ${err.message ?? err}`);
      fail++;
    }
  }

  const parts = [`${ok} converted`, `${fail} failed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  console.log(`\nDone: ${parts.join(", ")}.`);
}

main();
