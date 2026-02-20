import { basename, dirname, join, extname } from "path";

export type OutboundFormat = "docx" | "pptx" | "html";

const BLOCKED_PANDOC_FLAGS = new Set(["--filter", "-F", "--lua-filter"]);

function sanitizePandocArgs(args: string[]): void {
  for (const arg of args) {
    const flag = arg.split("=")[0];
    if (BLOCKED_PANDOC_FLAGS.has(flag)) {
      throw new Error(
        `Blocked Pandoc flag: "${flag}" can execute arbitrary code and is not allowed.`
      );
    }
  }
}

let pandocAvailable: boolean | null = null;

async function checkPandoc(): Promise<boolean> {
  if (pandocAvailable !== null) return pandocAvailable;

  try {
    const proc = Bun.spawn(["pandoc", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    pandocAvailable = code === 0;
  } catch {
    pandocAvailable = false;
  }

  return pandocAvailable;
}

export async function convertMarkdownTo(
  inputPath: string,
  format: OutboundFormat,
  outputDir?: string,
  extraArgs?: string[]
): Promise<string> {
  if (!(await checkPandoc())) {
    throw new Error(
      "Pandoc is required for outbound conversion (md → docx/pptx/html).\nInstall: brew install pandoc"
    );
  }

  if (extraArgs?.length) sanitizePandocArgs(extraArgs);

  const name = basename(inputPath, extname(inputPath));
  const dir = outputDir ?? dirname(inputPath);
  const outPath = join(dir, `${name}.${format}`);

  const args = ["pandoc", inputPath, ...extraArgs ?? [], "-o", outPath];
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const code = await proc.exited;

  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Pandoc failed (exit ${code}): ${stderr.trim()}`);
  }

  return outPath;
}
