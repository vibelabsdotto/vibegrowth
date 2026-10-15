import { notPorted } from "../collector"

/** Placeholder: source not ported yet, every run ends with ok:false. */
export const geoChatgpt = notPorted({
  id: "geo-chatgpt",
  label: "GEO-Check ChatGPT",
  channelKinds: ["website", "other"],
  secrets: false,
  configSchema: {
    brandPatterns: {
      description: "Regex-Muster, die eindeutig die Marke nennen",
      required: true,
      type: "string[]",
    },
    brandPatternsAmbiguous: {
      description: "Mehrdeutige Muster, zählen nur zusammen mit brandContext",
      required: false,
      type: "string[]",
    },
    brandContext: {
      description: "Regex für den Themenkontext mehrdeutiger Treffer",
      required: false,
      type: "string",
    },
  },
})
