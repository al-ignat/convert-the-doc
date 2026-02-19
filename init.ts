import * as p from "@clack/prompts";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  type Config,
  type TemplateConfig,
  LOCAL_CONFIG_NAME,
  GLOBAL_CONFIG_PATH,
  serializeConfig,
} from "./config";
import type { OutputFormat } from "./convert";

export async function runInit(isGlobal: boolean) {
  const targetPath = isGlobal ? GLOBAL_CONFIG_PATH : LOCAL_CONFIG_NAME;

  p.intro("con-the-doc init");

  if (existsSync(targetPath)) {
    const overwrite = await p.confirm({
      message: `Config already exists at ${targetPath}. Overwrite?`,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Cancelled.");
      return;
    }
  }

  const format = await p.select<OutputFormat>({
    message: "Default output format for Markdown files:",
    options: [
      { value: "docx" as OutputFormat, label: "Word", hint: ".docx" },
      { value: "pptx" as OutputFormat, label: "PowerPoint", hint: ".pptx" },
      { value: "html" as OutputFormat, label: "HTML", hint: ".html" },
    ],
  });
  if (p.isCancel(format)) { p.cancel("Cancelled."); return; }

  const outputDirChoice = await p.select<string>({
    message: "Output directory:",
    options: [
      { value: "same" as string, label: "Same as input file" },
      { value: "custom" as string, label: "Custom path" },
    ],
  });
  if (p.isCancel(outputDirChoice)) { p.cancel("Cancelled."); return; }

  let outputDir: string | undefined;
  if (outputDirChoice === "custom") {
    const dir = await p.text({
      message: "Output directory path:",
      placeholder: "./out",
    });
    if (p.isCancel(dir)) { p.cancel("Cancelled."); return; }
    outputDir = dir;
  }

  const addToc = await p.confirm({
    message: "Add table of contents by default?",
    initialValue: false,
  });
  if (p.isCancel(addToc)) { p.cancel("Cancelled."); return; }

  const config: Config = {
    defaults: {
      format,
      ...(outputDir ? { outputDir } : {}),
    },
  };

  if (addToc) {
    config.pandoc = {
      [format]: ["--toc"],
    };
  }

  const wantTemplate = await p.confirm({
    message: "Create a named template?",
    initialValue: false,
  });
  if (p.isCancel(wantTemplate)) { p.cancel("Cancelled."); return; }

  if (wantTemplate) {
    const tpl = await promptTemplate();
    if (tpl) {
      config.templates = { [tpl.name]: tpl.config };
    }
  }

  const yaml = serializeConfig(config);

  p.log.info(`Config to write to ${targetPath}:\n${yaml}`);

  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await Bun.write(targetPath, yaml);

  p.outro(`Config saved to ${targetPath}`);
}

async function promptTemplate(): Promise<{
  name: string;
  config: TemplateConfig;
} | null> {
  const name = await p.text({
    message: "Template name:",
    placeholder: "report",
    validate: (val) => {
      if (!val.trim()) return "Name is required.";
      if (/\s/.test(val)) return "No spaces allowed.";
    },
  });
  if (p.isCancel(name)) return null;

  const format = await p.select<OutputFormat>({
    message: "Template output format:",
    options: [
      { value: "docx" as OutputFormat, label: "Word", hint: ".docx" },
      { value: "pptx" as OutputFormat, label: "PowerPoint", hint: ".pptx" },
      { value: "html" as OutputFormat, label: "HTML", hint: ".html" },
    ],
  });
  if (p.isCancel(format)) return null;

  const desc = await p.text({
    message: "Description (optional):",
    placeholder: "Company report with TOC",
  });
  if (p.isCancel(desc)) return null;

  const pandocInput = await p.text({
    message: "Pandoc args (space-separated, optional):",
    placeholder: "--toc --reference-doc=./template.docx",
  });
  if (p.isCancel(pandocInput)) return null;

  const pandocArgs = pandocInput
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    name,
    config: {
      format,
      ...(pandocArgs.length ? { pandocArgs } : {}),
      ...(desc.trim() ? { description: desc.trim() } : {}),
    },
  };
}
