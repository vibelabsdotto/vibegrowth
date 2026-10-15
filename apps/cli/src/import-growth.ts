/** `import-growth`: one-off import of the website-growth system (POST /import/growth). */
import os from "node:os"
import path from "node:path"
import type { Command } from "commander"
import { api, run } from "./common"

/** Absolute path, ~ expanded: the API resolves relative paths against its own cwd. */
const abs = (p: string) =>
  path.resolve(
    p === "~"
      ? os.homedir()
      : p.startsWith("~/")
        ? path.join(os.homedir(), p.slice(2))
        : p
  )

export function registerImportGrowth(program: Command) {
  program
    .command("import-growth")
    .description(
      "Website-Growth-System übernehmen (growth.db, sites.json, Workspace); idempotent"
    )
    .requiredOption("--db <path>", "growth.db (wird nur gelesen)")
    .requiredOption("--sites <path>", "sites.json")
    .option(
      "--workspace-root <dir>",
      "Ordner mit <site>/backlog.md und <site>/posts/ideas.md, z. B. ~/VibeLabs/seo"
    )
    .action(
      run((o: { db: string; sites: string; workspaceRoot?: string }) =>
        api.post(
          "/import/growth",
          {
            db: abs(o.db),
            sites: abs(o.sites),
            workspaceRoot: o.workspaceRoot ? abs(o.workspaceRoot) : undefined,
          },
          true
        )
      )
    )
}
