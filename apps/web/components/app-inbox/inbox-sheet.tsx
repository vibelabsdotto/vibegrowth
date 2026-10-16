"use client"

import * as React from "react"
import { label, STORE_LABEL } from "@/components/growth/format"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { InboxItem } from "@/lib/growth-types"
import { FeatureRequestDetails } from "./feature-request-thread"
import { InboxItemActions } from "./inbox-actions"
import { LinkedApprovals } from "./linked-approvals"
import { ReviewDetails } from "./review-details"

function sheetTitle(item: InboxItem) {
  if (item.type === "feature_request") return item.title
  if (item.title?.trim()) return item.title
  return item.rating !== null
    ? `Bewertung mit ${item.rating} ${item.rating === 1 ? "Stern" : "Sternen"}`
    : "Bewertung"
}

/**
 * One inbox item (feature request or store review) in a sheet from the right:
 * thread or review, linked suggestions, and Max' actions in the footer.
 */
export function InboxSheet({
  item,
  projectName,
  open,
  onOpenChange,
  onClosed,
  finalFocus,
}: {
  item: InboxItem | null
  projectName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
  finalFocus: () => HTMLElement | null
}) {
  // Focus the scrollable body on open: keyboard users can scroll right away, and no
  // action button looks preselected.
  const bodyRef = React.useRef<HTMLDivElement>(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed()
      }}
    >
      <SheetContent
        side="right"
        initialFocus={bodyRef}
        finalFocus={finalFocus}
        className="gap-0 data-[side=right]:w-full motion-reduce:transition-none data-[side=right]:sm:max-w-xl"
      >
        {item ? (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="line-clamp-2 break-words">
                {sheetTitle(item)}
              </SheetTitle>
              <SheetDescription>
                {item.type === "feature_request"
                  ? "Feature Request aus Featurama"
                  : `Bewertung aus ${label(STORE_LABEL, item.store)}`}
              </SheetDescription>
            </SheetHeader>
            <div
              ref={bodyRef}
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 outline-none"
            >
              {item.type === "feature_request" ? (
                <FeatureRequestDetails
                  request={item}
                  projectName={projectName}
                />
              ) : (
                <ReviewDetails review={item} projectName={projectName} />
              )}
              {item.approvals.length ? (
                <>
                  <Separator />
                  <section
                    aria-labelledby="inbox-sheet-approvals"
                    className="flex flex-col gap-2"
                  >
                    <h3
                      id="inbox-sheet-approvals"
                      className="text-sm font-medium"
                    >
                      Vorschläge
                    </h3>
                    <LinkedApprovals approvals={item.approvals} />
                  </section>
                </>
              ) : null}
            </div>
            <SheetFooter className="mt-0 border-t">
              <InboxItemActions
                key={`${item.itemId}:${item.state}`}
                item={item}
                onDone={() => onOpenChange(false)}
              />
            </SheetFooter>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>Eintrag</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}
