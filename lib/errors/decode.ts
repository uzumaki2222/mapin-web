import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

// Converts wallet / RPC / contract failures into specific, user-facing mapin messages.
// Infrastructure names are never shown: contract error names are mapped or sanitised.

const CONTRACT_ERRORS: Record<string, string> = {
  // launch factory
  NotWhitelisted: "Launching is currently restricted by the launch protocol. Try again later.",
  LaunchFeeNotPaid: "The launch fee changed on-chain. Retry the launch to use the current fee.",
  LaunchConfigDisabled: "The launch configuration is disabled on-chain. Try again later.",
  LaunchEconomicsMismatch: "The launch terms changed on-chain while you were launching. Retry to use the current terms.",
  InvalidTokenParams: "Token name and ticker are required.",
  CreatorTaxTooHigh: "The creator fee is above the protocol maximum.",
  CombinedFeeTooHigh: "The creator fee is too high for this market.",
  PairTokenNotApproved: "The selected pair asset is not accepted on-chain.",
  InvalidLaunchConfigId: "The launch configuration was rejected on-chain.",
  LaunchDeployerNotSet: "The launch protocol is not ready right now. Try again later.",
  LaunchDependenciesNotWired: "The launch protocol is not ready right now. Try again later.",
  NotLaunchForwarder: "The launch router is not authorised on-chain. Launch without an initial buy.",
  ExemptionListTooLong: "Too many anti-snipe exemptions.",
  TokenNotFound: "This token is not registered with the launch protocol.",
  NotReadyToGraduate: "The bonding curve is not full yet.",
  NothingToGraduate: "There is nothing to graduate yet.",
  WrongGraduationPhase: "Graduation already moved on. Refresh the page.",
  AlreadyGraduated: "This market already graduated. Refresh to trade on Uniswap v4.",
  GraduationSeedNotViable: "The graduation pool cannot be created at this price yet.",
  // bonding curve
  CurveGraduated: "This market's bonding curve is closed (it is graduating). Refresh the page.",
  SlippageExceeded: "Price moved beyond your slippage tolerance. Refresh the quote or increase slippage.",
  InsufficientOutputAmount: "Amount is too small to receive anything at the current price.",
  InsufficientInputAmount: "Amount is too small for this market.",
  InsufficientLiquidity: "The bonding curve does not have enough liquidity for this trade.",
  NativeValueMismatch: "The ETH sent does not match the trade amount. Retry.",
  UnexpectedNativeValue: "ETH was sent to a trade that does not take ETH.",
  ZeroAmount: "Enter an amount above 0.",
  NotInitialized: "This market is not live yet.",
  TransferFailed: "Token transfer failed. Check your balance and approval.",
  SafeERC20FailedOperation: "Token transfer failed. Check your balance and approval.",
  ReentrancyGuardReentrantCall: "The transaction was rejected by the contract. Retry.",
  // Uniswap v4 router
  V4TooLittleReceived: "Price moved beyond your slippage tolerance. Refresh the quote or increase slippage.",
  TransactionDeadlinePassed: "The swap deadline passed before it was mined. Try again.",
  AllowanceExpired: "The swap approval expired. Retry the trade.",
  InsufficientAllowance: "The swap router is not approved to move your tokens. Retry the trade.",
};

/** Strip infrastructure names from anything user-visible. */
export function sanitize(text: string): string {
  return text.replace(/\bflap(\.sh)?\b|\bpons\b/gi, "").replace(/\s{2,}/g, " ").trim();
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
      return { kind: "insufficient_funds", message: "Insufficient ETH to cover the amount plus network gas." };
    }
    if (has("ChainMismatchError") || has("ChainNotConfiguredError")) {
      return { kind: "wrong_network", message: "Your wallet is on the wrong network. Switch to Robinhood Chain." };
    }
    if (has("ConnectorNotFoundError") || has("ProviderNotFoundError")) {
      return { kind: "wallet_missing", message: "No wallet found. Install MetaMask, Rabby, OKX Wallet or Robinhood Wallet." };
    }
    if (has("WaitForTransactionReceiptTimeoutError") || has("TimeoutError")) {
      return { kind: "timeout", message: "Robinhood Chain did not respond in time. Check the transaction on Blockscout before retrying." };
    }
    if (has("TransactionReceiptNotFoundError")) {
      return { kind: "rpc", message: "The transaction was not found yet. It may have been dropped — check Blockscout before retrying." };
    }
    if (has("HttpRequestError") || has("RpcRequestError") || has("LimitExceededRpcError") || has("InternalRpcError")) {
      const detail = sanitize(String((err as { details?: string }).details ?? err.shortMessage ?? "")).slice(0, 160);
      return { kind: "rpc", message: `The Robinhood Chain RPC is unavailable or rate-limited. Try again in a moment.${detail ? ` (${detail})` : ""}` };
    }
    if (has("SwitchChainError") || has("UnsupportedChainIdError")) {
      return { kind: "wrong_network", message: "Could not switch networks. Switch to Robinhood Chain in your wallet." };
    }
    return { kind: "unknown", message: sanitize(err.shortMessage || err.message).slice(0, 240) };
  }

  if (e?.code === 4902) {
    return { kind: "wrong_network", message: "Robinhood Chain is not added to your wallet yet. Use “Add Robinhood Chain”." };
  }
  if (e?.code === -32002) {
    return { kind: "rejected", message: "Your wallet already has a pending request. Open the wallet to continue." };
  }
  if (err instanceof Error) return { kind: "unknown", message: sanitize(err.message).slice(0, 240) || `${context} failed.` };
  return { kind: "unknown", message: `${context} failed.` };
}
