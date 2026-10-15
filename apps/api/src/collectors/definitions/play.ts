import { notPorted } from "../collector"

/** Placeholder: source not ported yet, every run ends with ok:false. */
export const play = notPorted({
  id: "play",
  label: "Google Play Console",
  channelKinds: ["android"],
  secrets: true,
  configSchema: {
    package: {
      description: "Paketname der App, z. B. com.max.mannstein.dazeforprivate",
      required: true,
      type: "string",
    },
    gcsBucket: {
      description: "Cloud-Storage-Bucket der Play-Berichte (pubsite_prod_…)",
      required: true,
      type: "string",
    },
  },
})
