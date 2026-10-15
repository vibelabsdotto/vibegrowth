import { notPorted } from "../collector"

/** Placeholder: source not ported yet, every run ends with ok:false. */
export const app = notPorted({
  id: "app",
  label: "App-Analytics (Firebase/GA4 App)",
  channelKinds: ["ios", "android"],
  secrets: true,
  configSchema: {
    ga4Property: {
      description:
        "GA4-Property der App (properties/…), leer wenn nur Firebase",
      required: false,
      type: "string",
    },
    firebaseProject: {
      description: "Firebase-Projekt-ID, z. B. daze-for-private",
      required: false,
      type: "string",
    },
    funnelEvents: {
      description:
        "App-Events für den Funnel, z. B. first_open, first_entry_created",
      required: false,
      type: "string[]",
    },
    keyEvents: {
      description: "Schlüssel-Events, z. B. first_entry_created",
      required: false,
      type: "string[]",
    },
  },
})
