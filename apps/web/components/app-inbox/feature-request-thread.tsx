"use client"

import { MessageSquare, ThumbsUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { fmtDate, label } from "@/components/growth/format"
import type {
  FeatureRequestComment,
  InboxFeatureRequest,
} from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { FEATURAMA_STATUS_LABEL, fmtStamp, plural } from "./labels"
import { LinkedApprovals } from "./linked-approvals"
import { NeedsReplyToken, NotApprovedNote } from "./markers"

type Entry = {
  id: string
  developer: boolean
  author: string | null
  content: string
  createdAt: string | null
}

/** Request body first, then all comments in chronological order. */
function thread(r: InboxFeatureRequest): Entry[] {
  const comments = [...r.comments]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c: FeatureRequestComment) => ({
      id: c.id,
      developer: c.role === "developer",
      author: c.author,
      content: c.content,
      createdAt: c.createdAt,
    }))
  const body = r.body?.trim()
  return body
    ? [
        {
          id: "request",
          developer: false,
          author: null,
          content: body,
          createdAt: r.requestedAt,
        },
        ...comments,
      ]
    : comments
}

export function platformText(r: InboxFeatureRequest) {
  return [r.platform, r.appVersion ? `Version ${r.appVersion}` : null]
    .filter(Boolean)
    .join(" · ")
}

/** Thread view of a feature request: drawer from the right. */
export function FeatureRequestThread({
  request: r,
  projectName,
  open,
  onOpenChange,
  onClosed,
  finalFocus,
}: {
  request: InboxFeatureRequest | null
  projectName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
  finalFocus: () => HTMLElement | null
}) {
  const entries = r ? thread(r) : []
  const platform = r ? platformText(r) : ""
  return (
    <Drawer
      open={open}
      swipeDirection="right"
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed()
      }}
    >
      <DrawerContent
        className="h-dvh w-full max-w-full motion-reduce:transition-none sm:w-[min(40rem,calc(100vw-3rem))]"
        finalFocus={finalFocus}
      >
        {r ? (
          <>
            <DrawerHeader>
              <DrawerTitle className="line-clamp-2 break-words">
                {r.title}
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                Feature Request mit allen Kommentaren
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  {r.needsReply ? <NeedsReplyToken /> : null}
                  {r.status ? (
                    <Badge variant="outline">
                      {label(FEATURAMA_STATUS_LABEL, r.status)}
                    </Badge>
                  ) : null}
                  {projectName ? (
                    <Badge variant="secondary">{projectName}</Badge>
                  ) : null}
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <ThumbsUp aria-hidden="true" className="size-3" />
                    {plural(r.votes, "Stimme", "Stimmen")}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <MessageSquare aria-hidden="true" className="size-3" />
                    {plural(r.commentCount, "Kommentar", "Kommentare")}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Plattform</dt>
                  <dd>{platform || "unbekannt"}</dd>
                  <dt className="text-muted-foreground">Angefragt</dt>
                  <dd className="tabular-nums">{fmtDate(r.requestedAt)}</dd>
                </dl>
                {!r.approved ? <NotApprovedNote /> : null}
              </div>

              {r.approvals.length ? (
                <section
                  aria-labelledby="fr-thread-approvals"
                  className="flex flex-col gap-2"
                >
                  <h3 id="fr-thread-approvals" className="text-sm font-medium">
                    Vorschläge
                  </h3>
                  <LinkedApprovals approvals={r.approvals} />
                </section>
              ) : null}

              <Separator />

              <section
                aria-labelledby="fr-thread-comments"
                className="flex flex-col gap-3"
              >
                <h3 id="fr-thread-comments" className="text-sm font-medium">
                  Verlauf
                </h3>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Kein Text und keine Kommentare.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {entries.map((e) => (
                      <li
                        key={e.id}
                        className={cn(
                          "flex min-w-0 flex-col gap-1.5 rounded-lg p-3",
                          e.developer
                            ? "ml-6 bg-muted sm:ml-12"
                            : "mr-6 border sm:mr-12"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <Badge variant={e.developer ? "default" : "outline"}>
                            {e.developer ? "Entwickler" : "Nutzer"}
                          </Badge>
                          {e.developer && e.author ? (
                            <span className="font-medium">{e.author}</span>
                          ) : null}
                          {e.id === "request" ? (
                            <span className="text-muted-foreground">
                              Anfrage
                            </span>
                          ) : null}
                          <time
                            dateTime={e.createdAt ?? undefined}
                            className="text-muted-foreground tabular-nums"
                          >
                            {fmtStamp(e.createdAt)}
                          </time>
                        </div>
                        <p className="text-sm break-words whitespace-pre-line">
                          {e.content}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </DrawerBody>
            <DrawerFooter>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  In Featurama öffnen
                </a>
              ) : null}
              <DrawerClose render={<Button />}>Schließen</DrawerClose>
            </DrawerFooter>
          </>
        ) : (
          <DrawerHeader>
            <DrawerTitle>Feature Request</DrawerTitle>
          </DrawerHeader>
        )}
      </DrawerContent>
    </Drawer>
  )
}
