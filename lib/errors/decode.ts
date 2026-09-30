import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

// Converts wallet / RPC / contract failures into specific, user-facing mapin messages.
// Infrastructure names are never shown: contract error names are mapped or sanitised.

const CONTRACT_ERRORS: Record<string, string> = {
  FeatureDisabled: "This launch type is currently disabled on-chain. Add a buy or sell tax (a tax market) and try again.",
  PermissionlessCreateDisabled: "Market creation is temporarily disabled on-chain. Try again later.",
  ProtocolDisabled: "The market protocol is paused on-chain right now. Try again later.",
  TradeDisabled: "Trading is temporarily disabled on-chain.",
  QuoteTokenNotAllowed: "The selected pair asset is not accepted on-chain anymore. Pick another pair.",
  InvalidDexThresholdType: "The graduation threshold was rejected on-chain.",
  VanityAddressRequirementNotMet: "The generated token address was rejected. Regenerate the address and retry.",
  TokenAlreadyStaged: "A token already exists at this address. Regenerate the address and retry.",
  MetaAlreadyUsedByOtherToken: "This metadata is already used by another token. Re-upload the metadata and retry.",
  InsufficientCreationFee: "The transaction value does not cover the creation fee.",
  InsufficientFee: "The transaction value does not cover the required fee.",
  InsufficientEth: "Not enough BNB was sent with the transaction.",
  InsufficientValueForTaxTokenCreation: "Tax markets paired with a token need a tiny BNB amount attached. Retry the launch.",
  InvalidTaxBps: "The tax rate was rejected on-chain.",
  InvalidTaxDistribution: "The tax revenue split must add up to 100%.",
  TaxDurationTooLong: "Tax duration is too long.",
  TaxDurationTooShort: "Tax duration is too short.",
  AntiFarmerDurationTooLong: "Anti-farming window is too long.",
  AntiFarmerDurationTooShort: "Anti-farming window is too short.",
  RateLimitExceeded: "This wallet created a market very recently. Wait a little before launching another.",
  SpammerBlocked: "This wallet is blocked from creating markets on-chain.",
  SlippageTooHigh: "Price moved beyond your slippage tolerance. Refresh the quote or increase slippage.",
  AmountTooSmall: "Amount is too small for this market.",
  TokenNotTradable: "This market is not tradable on the bonding curve (it may have just graduated). Refresh.",
  TokenNotFound: "This token is not registered with the market protocol.",
  TokenAlreadyDEXed: "This market has graduated to PancakeSwap. Refresh to trade there.",
  NativeToQuoteSwapNotSupported: "Paying with BNB is not supported for this pair. Use the pair asset instead.",
  TransferFromFailed: "Token transfer failed. Check your balance and approval.",
  SaltAlreadyLockedByAnotherUser: "This token address is reserved by someone else. Regenerate the address.",
  SaltLockTokenVersionMismatch: "This token address is reserved for a different token type. Regenerate the address.",
  InvalidMigratorType: "The liquidity migration setting was rejected on-chain.",
  // PancakeSwap router
  "PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT": "Price moved beyond your slippage tolerance. Refresh the quote or increase slippage.",
  "PancakeRouter: EXPIRED": "The swap deadline passed before it was mined. Try again.",
  "TransferHelper: TRANSFER_FROM_FAILED": "Token transfer failed. Check your balance and approval.",
};

/** Strip infrastructure names from anything user-visible. */
export function sanitize(text: string): string {
  return text.replace(/flap(\.sh)?/gi, "").replace(/\s{2,}/g, " ").trim();
}

function humanizeErrorName(name: string): string {
  const words = sanitize(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : "Unknown error";
}

export interface DecodedError {
  message: string;
  kind:
    | "rejected"
    | "wallet_missing"
    | "wrong_network"
    | "insufficient_funds"
    | "contract"
    | "rpc"
    | "timeout"
    | "replaced"
    | "unknown";
  contractError?: string;
}

export function decodeError(err: unknown, context = "The request"): DecodedError {
  // Developer diagnostics (never shown verbatim to users).
  if (typeof window !== "undefined") console.error(`[mapin] ${context} failed`, err);

  const e = err as { code?: number; name?: string; message?: string; shortMessage?: string };
  if (e?.code === 4001 || e?.name === "UserRejectedRequestError") {
    return { kind: "rejected", message: `${context} was rejected in your wallet.` };
  }

  if (err instanceof BaseError) {
    const rejected = err.walk((x) => x instanceof UserRejectedRequestError || (x as { code?: number }).code === 4001);
    if (rejected) return { kind: "rejected", message: `${context} was rejected in your wallet.` };

    const revert = err.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert) {
      const name = revert.data?.errorName ?? revert.reason ?? "";
      const mapped = name && CONTRACT_ERRORS[name];
      if (mapped) return { kind: "contract", contractError: sanitize(name), message: mapped };
      if (revert.reason) {
        const byReason = CONTRACT_ERRORS[revert.reason];
        return { kind: "contract", contractError: sanitize(revert.reason), message: byReason ?? `Transaction would fail: ${sanitize(revert.reason)}` };
      }
      if (name) return { kind: "contract", contractError: sanitize(name), message: `Transaction would fail: ${humanizeErrorName(name)}.` };
      return { kind: "contract", message: "Transaction would fail on-chain (the contract reverted without a reason)." };
    }

    const names = new Set<string>();
    err.walk((x) => {
      if (x && typeof x === "object" && "name" in x) names.add(String((x as { name: string }).name));
      return false;
    });
    const has = (n: string) => names.has(n);
    if (has("InsufficientFundsError")) {
      return { kind: "insufficient_funds", message: "Insufficient BNB to cover the amount plus network gas." };
    }
    if (has("ChainMismatchError") || has("ChainNotConfiguredError")) {
      return { kind: "wrong_network", message: "Your wallet is on the wrong network. Switch to BNB Smart Chain." };
    }
    if (has("ConnectorNotFoundError") || has("ProviderNotFoundError")) {
      return { kind: "wallet_missing", message: "No wallet found. Install MetaMask, Rabby, OKX Wallet or Binance Wallet." };
    }
    if (has("WaitForTransactionReceiptTimeoutError") || has("TimeoutError")) {
      return { kind: "timeout", message: "BNB Chain did not respond in time. Check the transaction on BscScan before retrying." };
    }
    if (has("TransactionReceiptNotFoundError")) {
      return { kind: "rpc", message: "The transaction was not found yet. It may have been dropped — check BscScan before retrying." };
    }
    if (has("HttpRequestError") || has("RpcRequestError") || has("LimitExceededRpcError") || has("InternalRpcError")) {
      return { kind: "rpc", message: "The BNB Chain RPC is unavailable or rate-limited. Try again in a moment." };
    }
    if (has("SwitchChainError") || has("UnsupportedChainIdError")) {
      return { kind: "wrong_network", message: "Could not switch networks. Switch to BNB Smart Chain in your wallet." };
    }
    return { kind: "unknown", message: sanitize(err.shortMessage || err.message).slice(0, 240) };
  }

  if (e?.code === 4902) {
    return { kind: "wrong_network", message: "BNB Smart Chain is not added to your wallet yet. Use “Add BNB Chain”." };
  }
  if (e?.code === -32002) {
    return { kind: "rejected", message: "Your wallet already has a pending request. Open the wallet to continue." };
  }
  if (err instanceof Error) return { kind: "unknown", message: sanitize(err.message).slice(0, 240) || `${context} failed.` };
  return { kind: "unknown", message: `${context} failed.` };
}
