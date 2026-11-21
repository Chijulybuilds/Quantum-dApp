import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { conclaveAbi } from "../lib/abi";
import { api } from "../lib/api";
import { PQC_KEY_STATUS, appConfig, qorePqcAbi } from "../lib/config";

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
 * The connected wallet's "passport": its ML-DSA-87 key from the chain's registry (read with wagmi
 * from the pqcKeyStatus precompile) and its role in Conclave.
 */
export function usePassport() {
  const { address, isConnected, connector } = useAccount();
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
    isGuardian: Boolean(address && dao.data && dao.data.guardian.toLowerCase() === address.toLowerCase()),
  };
}
