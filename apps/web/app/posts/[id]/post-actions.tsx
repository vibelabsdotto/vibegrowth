"use client"

import { RefreshCw } from "lucide-react"
import * as React from "react"
import { markPostPosted, rescanPost } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

export function PostActions({
  id,
  accountId,
  dir,
  posted,
}: {
  id: number
  accountId: string
  dir: string
  posted: boolean
}) {
  const [pending, setPending] = React.useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true)
          const res = await rescanPost(accountId, dir)
          setPending(false)
          toast.add(
            res.ok
              ? {
                  title: "Ordner neu eingelesen",
                  type: "success",
                  timeout: 3000,
                }
              : {
                  title: "Nicht eingelesen",
                  description: res.error,
                  type: "error",
                }
          )
        }}
      >
        <RefreshCw data-icon="inline-start" aria-hidden="true" />
        Neu einlesen
      </Button>
      {!posted ? (
        <FormDrawer
          title="Als gepostet markieren"
          description="TikTok-Link oder ID. Der Zahlen-Abruf ordnet den Post sonst automatisch über Slide 1 zu."
          trigger={(open) => (
            <Button size="sm" onClick={open}>
              Als gepostet markieren
            </Button>
          )}
          fields={[
            {
              name: "url",
              label: "TikTok-Link",
              type: "url",
              placeholder: "https://www.tiktok.com/@…/photo/…",
            },
            {
              name: "tiktokId",
              label: "TikTok-ID",
              description: "Nur nötig ohne Link",
            },
            { name: "postedAt", label: "Gepostet am", type: "date" },
          ]}
          action={(v) => markPostPosted(id, v)}
          successMessage="Als gepostet markiert"
        />
      ) : null}
    </>
  )
}
