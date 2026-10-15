#!/usr/bin/env node
// Old name of the VibeGrowth CLI. Same commands, same JSON, same exit codes.
process.env.VIBEGROWTH_CLI_NAME ??= "vibeshorts"
await import("./vibegrowth.mjs")
