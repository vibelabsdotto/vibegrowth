import type { ComponentProps, ElementType } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

/** Element with fixed classes; drops the hast `node` prop react-markdown passes. */
function el<T extends ElementType>(Tag: T, className: string) {
  function Styled(props: ComponentProps<T> & { node?: unknown }) {
    const { node, className: extra, ...rest } = props as {
      node?: unknown
      className?: string
    }
    void node
    const Element = Tag as ElementType
    return <Element className={cn(className, extra)} {...rest} />
  }
  return Styled
}

const components: Components = {
  h1: el("h2", "mt-6 text-lg font-semibold first:mt-0"),
  h2: el("h3", "mt-6 text-base font-semibold first:mt-0"),
  h3: el("h4", "mt-4 font-semibold first:mt-0"),
  h4: el("h5", "mt-4 font-medium first:mt-0"),
  p: el("p", "my-2 leading-relaxed"),
  ul: el("ul", "my-2 list-disc pl-5"),
  ol: el("ol", "my-2 list-decimal pl-5"),
  li: el("li", "my-0.5"),
  a: el("a", "underline underline-offset-4"),
  blockquote: el("blockquote", "my-3 border-l-2 pl-3 text-muted-foreground"),
  hr: el("hr", "my-4"),
  code: el("code", "rounded bg-muted px-1 py-0.5 font-mono text-xs"),
  pre: el(
    "pre",
    "my-3 overflow-x-auto rounded-md bg-muted p-3 text-xs [&>code]:bg-transparent [&>code]:p-0"
  ),
  table: el("table", "my-3 block w-full overflow-x-auto text-left"),
  th: el("th", "border-b px-2 py-1 font-medium"),
  td: el("td", "border-b px-2 py-1 align-top"),
}

/** Markdown from the database. Raw HTML is not rendered. */
export function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={cn("text-sm break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
