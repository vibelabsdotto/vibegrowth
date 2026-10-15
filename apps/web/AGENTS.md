<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VibeGrowth Web

- Kein DB-Zugriff, kein Import aus `apps/api`. Server Components lesen über die API (`VIBEGROWTH_API_URL`, Default `http://127.0.0.1:4311`), Server Actions schreiben mit `X-Actor: max` und geben `{ok,data}|{ok:false,error}` zurück.
- `proxy.ts` lehnt fremde Hosts ab. Bindet nur an `127.0.0.1`.
- UI: shadcn-Komponenten zuerst (`npx shadcn@latest add <name>` in `apps/web`), Overlays als Drawer von rechts, Toasts über `toast.add`, Charts über `components/ui/chart.tsx` (Recharts) ohne Animation.
