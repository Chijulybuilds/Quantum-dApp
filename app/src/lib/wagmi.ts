import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { qorechainTestnet, qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

import { appConfig } from "./config";

/**
 * QoreX first: it holds the member's ML-DSA-87 key. It connects over EIP-6963 and re-reads the
 * account when the tab regains focus (QoreX does not emit accountsChanged yet).
 */
const connectors = connectorsForWallets(
  [
    {
      groupName: "Post-quantum",
      wallets: [() => qorexWallet({ pollAccountsOnFocus: true })],
    },
    { groupName: "Other wallets", wallets: [metaMaskWallet, injectedWallet] },
  ],
  { appName: "Conclave", projectId: appConfig.walletConnectProjectId },
);

export const wagmiConfig = createConfig({
  chains: [qorechainTestnet],
  connectors,
  transports: { [qorechainTestnet.id]: http("https://evm-testnet.qore.host") },
  ssr: false,
});

export { qorechainTestnet };

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
