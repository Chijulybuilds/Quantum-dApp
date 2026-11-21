import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A throwaway, well-known test mnemonic: the tests never touch the network.
    env: {
      CONCLAVE_MNEMONIC: "test test test test test test test test test test test junk",
      DEMO_MODE: "false",
    },
  },
});
