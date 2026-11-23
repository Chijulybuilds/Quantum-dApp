import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { conclaveAbi } from "../lib/abi";
import { api } from "../lib/api";
import { PQC_KEY_STATUS, appConfig, qorePqcAbi } from "../lib/config";
import { useQorexIdentity } from "../lib/qorexIdentity";

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000, retry: 1 });
}

export function useDao() {
  return useQuery({ queryKey: ["dao"], queryFn: api.dao, refetchInterval: 12_000, retry: 1 });
}

export function useProposals() {
  return useQuery({ queryKey: ["proposals"], queryFn: api.proposals, refetchInterval: 8_000, retry: 1 });
}

export function useActivity() {
  return useQuery({ queryKey: ["activity"], queryFn: api.activity, refetchInterval: 8_000, retry: 1 });
}

export function useRelayer() {
  return useQuery({ queryKey: ["relayer"], queryFn: api.relayer, refetchInterval: 15_000, retry: 1 });
}

/** Refreshes everything after a relayed transaction. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useConclaveAddress(): Address | undefined {
  const dao = useDao();
  return appConfig.conclaveAddress ?? dao.data?.address;
}

/**
 * Whether `address` is an account QoreX can sign Conclave messages with: from QoreX itself for the
 * connected account, otherwise from the key type the chain recorded (via the relayer API).
 */
export function useAccountKind(address?: Address): "cosmos" | "ethereum" | "unknown" | undefined {
  const qorex = useQorexIdentity();
  const own = qorex && address && qorex.address.toLowerCase() === address.toLowerCase() ? qorex.kind : undefined;
  const info = useQuery({
    queryKey: ["accountKind", address],
    queryFn: () => api.keyInfo(address!),
    enabled: Boolean(address) && !own,
    staleTime: 60_000,
    retry: 1,
  });
  return own ?? info.data?.accountType;
}

/**
 * The connected wallet's "passport": its ML-DSA-87 key from the chain's registry (read with wagmi
 * from the pqcKeyStatus precompile) and its role in Conclave.
 */
export function usePassport() {
  const evm = useAccount();
  const qorex = useQorexIdentity();
  // QoreX signs through its native connection, so its account is the member identity.
  const address = qorex?.address ?? evm.address;
  const isConnected = Boolean(qorex) || evm.isConnected;
  const connector = qorex ? { name: "QoreX" } : evm.connector;
  const conclave = useConclaveAddress();
  const dao = useDao();

  const key = useReadContract({
    address: PQC_KEY_STATUS,
    abi: qorePqcAbi,
    functionName: "pqcKeyStatus",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 30_000 },
  });
  const member = useReadContract({
    address: conclave,
    abi: conclaveAbi,
    functionName: "isMember",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && conclave), refetchInterval: 20_000 },
  });

  const accountKind = useAccountKind(address);
  const [registered, algorithmId, pubkey] = (key.data ?? [false, 0, "0x"]) as readonly [boolean, number, Hex];
  const keyBytes = pubkey ? (pubkey.length - 2) / 2 : 0;
  return {
    address,
    isConnected,
    walletName: connector?.name,
    loading: key.isLoading || member.isLoading,
    key: {
      registered,
      algorithmId,
      pubkey,
      keyBytes,
      mlDsa87: registered && algorithmId === 1 && keyBytes === 2592,
    },
    isMember: Boolean(member.data),
    /** "ethereum": QoreX cannot sign Conclave messages with this account. */
    accountKind,
    isGuardian: Boolean(address && dao.data && dao.data.guardian.toLowerCase() === address.toLowerCase()),
  };
}
