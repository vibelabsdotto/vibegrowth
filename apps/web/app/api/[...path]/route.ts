import { forward } from "@/lib/forward"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ path: string[] }> }

/** Browser calls to /api/* go to apps/api (contract §4). */
async function handle(req: Request, ctx: Ctx) {
  const { path } = await ctx.params
  return forward(req, `/api/${path.map(encodeURIComponent).join("/")}`)
}

export const GET = handle
export const HEAD = handle
export const POST = handle
export const PATCH = handle
export const PUT = handle
export const DELETE = handle
