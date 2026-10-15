import { notPorted } from "../collector"

/** Placeholder: source not ported yet, every run ends with ok:false. */
export const asc = notPorted({
  id: "asc",
  label: "App Store Connect",
  channelKinds: ["ios"],
  secrets: true,
  configSchema: {
    appId: {
      description: "Apple-App-ID, z. B. 6504710904",
      required: true,
      type: "string",
    },
    providerId: {
      description: "Provider-ID für App-Analytics-Kampagnen",
      required: false,
      type: "string",
    },
    profile: {
      description: "asc-CLI-Profil (leer = Standardprofil)",
      required: false,
      type: "string",
    },
  },
})
