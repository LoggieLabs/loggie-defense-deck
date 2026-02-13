/**
 * Browser entry point for secure-intake-client.
 * Bundled by esbuild into a single ESM file with all deps inlined.
 */
export { createPilotAccessClient } from "@omnituum/secure-intake-client/presets/pilot-access";
export { checkCryptoCapability, resetCryptoCapabilityCache } from "@omnituum/secure-intake-client";
