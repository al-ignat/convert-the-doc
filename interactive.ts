import * as p from "@clack/prompts";
import { resolve, extname } from "path";
import { statSync, existsSync } from "fs";
import { convertFile, type OutputFormat } from "./convert";
import { writeOutput } from "./output";
import { buildPlan, ValidationError } from "./validate";
import { scanForFiles, formatHint, type FileInfo } from "./scan";
import { buildPandocArgs, type Config } from "./config";

export type FormatChoice =
  | { kind: "format"; format: OutputFormat }
  | { kind: "template"; name: string; format: OutputFormat };

export async function runInteractive(config?: Config) {
  p.intro("con-the-doc");

  const filePath = await pickFile();
  if (!filePath) return;

  const choice = await pickFormat(filePath, config);
  if (!choice) return;

  const templateName = choice.kind === "template" ? choice.name : undefined;
  await convert(filePath, choice.format, config, templateName);

  p.outro("Done!");
}

async function pickFile(): Promise<string | null> {
  const { cwd, downloads } = scanForFiles();
  const hasFiles = cwd.length > 0 || downloads.length > 0;

  if (!hasFiles) {
    p.log.warn("No convertible files found in current folder or ~/Downloads.");
    return await manualInput();
  }

  type PickValue = string | symbol;
  const options: { value: PickValue; label: string; hint?: string }[] = [];

  if (cwd.length > 0) {
    for (const file of cwd) {
      options.push({
        value: file.path,
        label: file.name,
        hint: formatHint(file),
      });
    }
  }

  if (downloads.length > 0) {
    if (cwd.length > 0) {
      options.push({ value: "__sep__", label: "── Downloads ──", hint: "" });
    }
    for (const file of downloads) {
      options.push({
        value: file.path,
        label: file.name,
        hint: formatHint(file),
      });
    }
  }

  options.push({
    value: "__browse__",
    label: "Browse or paste a path…",
    hint: "",
  });

  const picked = await p.select({
    message: "Pick a file to convert:",
    options: options as any,
  });

  if (p.isCancel(picked)) {
    p.cancel("Cancelled.");
    return null;
  }

  if (picked === "__sep__") {
    return await pickFile();
  }

  if (picked === "__browse__") {
    return await manualInput();
  }

  return picked as string;
}

async function manualInput(): Promise<string | null> {
  const input = await p.text({
    message: "File path:",
    placeholder: "Drag a file here or type a path",
    validate: (val) => {
      if (!val.trim()) return "Path is required.";
      try {
        const stat = statSync(resolve(val));
        if (!stat.isFile()) return "Not a file.";
      } catch {
        return "File not found.";
      }
    },
  });

  if (p.isCancel(input)) {
    p.cancel("Cancelled.");
    return null;
  }

  return resolve(input);
}

async function pickFormat(
  filePath: string,
  config?: Config
): Promise<FormatChoice | null> {
  const isMarkdown = extname(filePath).toLowerCase() === ".md";

  type OptionValue = string;
  const options: { value: OptionValue; label: string; hint?: string }[] = isMarkdown
    ? [
        { value: "fmt:docx", label: "Word", hint: ".docx" },
        { value: "fmt:pptx", label: "PowerPoint", hint: ".pptx" },
        { value: "fmt:html", label: "HTML", hint: ".html" },
        { value: "fmt:json", label: "JSON", hint: ".json" },
        { value: "fmt:yaml", label: "YAML", hint: ".yaml" },
      ]
    : [
        { value: "fmt:md", label: "Markdown", hint: ".md" },
        { value: "fmt:json", label: "JSON", hint: ".json" },
        { value: "fmt:yaml", label: "YAML", hint: ".yaml" },
      ];

  // Add templates from config
  const templates = config?.templates;
  if (templates && Object.keys(templates).length > 0) {
    options.push({ value: "__sep__", label: "── Templates ──", hint: "" });
    for (const [name, tpl] of Object.entries(templates)) {
      options.push({
        value: `tpl:${name}`,
        label: name,
        hint: tpl.description ?? `.${tpl.format}`,
      });
    }
  }

  const picked = await p.select({
    message: "Output format:",
    options: options as any,
  });

  if (p.isCancel(picked)) {
    p.cancel("Cancelled.");
    return null;
  }

  if (picked === "__sep__") {
    return await pickFormat(filePath, config);
  }

  const val = picked as string;

  if (val.startsWith("tpl:")) {
    const name = val.slice(4);
    const tpl = templates![name];
    return { kind: "template", name, format: tpl.format };
  }

  const format = val.slice(4) as OutputFormat;
  return { kind: "format", format };
}

async function convert(
  filePath: string,
  format: OutputFormat,
  config?: Config,
  templateName?: string
) {
  const s = p.spinner();

  let plan;
  try {
    plan = buildPlan(filePath, format, {
      formatExplicit: true,
      defaultMdFormat: config?.defaults?.format,
    });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      p.log.error(err.message);
      return;
    }
    throw err;
  }

  // Resolve pandoc args for outbound
  if (plan.direction === "outbound" && config) {
    plan.pandocArgs = buildPandocArgs(plan.format, config, templateName);
    if (!plan.pandocArgs.length) plan.pandocArgs = undefined;
  }

  if (existsSync(plan.outputPath)) {
    const overwrite = await p.confirm({
      message: `Output file already exists: ${plan.outputPath}\nOverwrite?`,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Cancelled.");
      return;
    }
  }

  s.start("Converting…");

  try {
    if (plan.direction === "outbound") {
      const result = await convertFile(filePath, plan.format, {
        pandocArgs: plan.pandocArgs,
      });
      s.stop(`${result.sourcePath} → ${result.outputPath}`);
    } else {
      const result = await convertFile(filePath, plan.format);
      await writeOutput(plan.outputPath, result.formatted);
      s.stop(`${result.sourcePath} → ${plan.outputPath}`);
    }
  } catch (err: any) {
    s.stop("Conversion failed.");
    p.log.error(err.message ?? String(err));
  }
}
