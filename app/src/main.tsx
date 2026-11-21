import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";

import { App } from "./App";
import { qorechainTestnet, wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: true } },
});

const theme = darkTheme({
  accentColor: "#7b5cff",
  accentColorForeground: "#ffffff",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "large",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} initialChain={qorechainTestnet} modalSize="compact" appInfo={{ appName: "Conclave" }}>
          <HashRouter>
            <App />
          </HashRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
