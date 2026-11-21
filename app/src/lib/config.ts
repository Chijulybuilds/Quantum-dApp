import { getAddress, isAddress, type Address } from "viem";

const rawAddress = import.meta.env.VITE_CONCLAVE_ADDRESS as string | undefined;

export const appConfig = {
  /** Relayer API base. Empty = same origin (Vite proxies /api in development). */
  apiUrl: ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, ""),
  /** Optional build-time Conclave address; otherwise read from the relayer. */
  conclaveAddress: rawAddress && isAddress(rawAddress) ? (getAddress(rawAddress) as Address) : undefined,
  walletConnectProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || "conclave-dev",
  nativeChainId: "qorechain-diana",
  evmChainId: 9800,
  explorer: "https://explore.qore.network",
  faucet: "https://dashboard.qorechain.io/faucet",
  repo: "https://github.com/Chijulybuilds/Quantum-dApp",
};

export const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as const;
export const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as const;

export const txUrl = (hash: string) => `${appConfig.explorer}/tx/${hash}`;
export const addressUrl = (address: string) => `${appConfig.explorer}/account/${address}`;

/** ABI of QoreChain's PQC precompiles (IQorePQC). */
export const qorePqcAbi = [
  {
    type: "function",
    name: "pqcKeyStatus",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
    ],
  },
  {
    type: "function",
    name: "pqcVerify",
    stateMutability: "view",
    inputs: [
      { name: "pubkey", type: "bytes" },
      { name: "signature", type: "bytes" },
      { name: "message", type: "bytes" },
    ],
    outputs: [{ name: "valid", type: "bool" }],
  },
] as const;
