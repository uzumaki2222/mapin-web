import { test, expect, type Page } from "@playwright/test";

// Wallet UI tests with an in-page mock EIP-1193 provider announced over EIP-6963.
// No private key, seed phrase or real wallet is involved and nothing is ever broadcast.

const ADDR_1 = "0x1234567890abcdef1234567890abcdef1234abcd";
const ADDR_2 = "0x9999567890abcdef1234567890abcdef12349999";

async function installMockWallet(page: Page, opts: { rejectConnect?: boolean; startChainId?: string } = {}) {
  await page.addInitScript(({ ADDR_1, rejectConnect, startChainId }) => {
    type Listener = (...args: unknown[]) => void;
    const listeners: Record<string, Listener[]> = {};
    let chainId = startChainId;
    let accounts: string[] = [];
    const emit = (event: string, payload: unknown) => (listeners[event] ?? []).forEach((l) => l(payload));
    const err = (code: number, message: string) => Object.assign(new Error(message), { code });
    const provider = {
      isMockWallet: true,
      async request({ method, params }: { method: string; params?: unknown[] }) {
        switch (method) {
          case "eth_requestAccounts":
            if (rejectConnect) throw err(4001, "User rejected the request.");
            accounts = [ADDR_1];
            emit("connect", { chainId });
            return accounts;
          case "eth_accounts":
            return accounts;
          case "eth_chainId":
            return chainId;
          case "net_version":
            return String(parseInt(chainId, 16));
          case "wallet_requestPermissions":
          case "wallet_getPermissions":
            return [{ parentCapability: "eth_accounts" }];
          case "wallet_revokePermissions":
            accounts = [];
            return null;
          case "wallet_switchEthereumChain": {
            const target = (params?.[0] as { chainId: string }).chainId;
            chainId = target;
            emit("chainChanged", target);
            return null;
          }
          case "wallet_addEthereumChain":
            return null;
          case "personal_sign":
          case "eth_sendTransaction":
            throw err(4001, "Mock wallet never signs.");
          default:
            throw err(4200, `Unsupported method ${method}`);
        }
      },
      on(event: string, l: Listener) {
        (listeners[event] ??= []).push(l);
      },
      removeListener(event: string, l: Listener) {
        listeners[event] = (listeners[event] ?? []).filter((x) => x !== l);
      },
    };
    (window as unknown as { __mockWallet: unknown }).__mockWallet = {
      switchAccount(addr: string) {
        accounts = [addr];
        emit("accountsChanged", accounts);
      },
      setChain(id: string) {
        chainId = id;
        emit("chainChanged", id);
      },
    };
    const info = {
      uuid: "00000000-0000-4000-8000-000000000001",
      name: "Test Wallet",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'/%3E",
      rdns: "dev.codedmarkets.testwallet",
    };
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, { ADDR_1, rejectConnect: Boolean(opts.rejectConnect), startChainId: opts.startChainId ?? "0x1" });
}

test("home renders with Coded Markets branding only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Markets for code." })).toBeVisible();
  await expect(page.getByAltText("Coded Markets").first()).toBeVisible();
  for (const path of ["/", "/explore"]) {
    await page.goto(path);
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("flap");
    expect(text).not.toContain("bnb");
  }
});

test("connect via EIP-6963, switch to Robinhood Chain, follow account changes", async ({ page }) => {
  await installMockWallet(page, { startChainId: "0x1" });
  await page.goto("/");
  await page.getByTestId("connect-wallet").click();
  await expect(page.getByRole("dialog", { name: "Connect wallet" })).toBeVisible();
  await page.getByRole("button", { name: /Test Wallet/ }).click();

  const chip = page.getByTestId("account-chip");
  await expect(chip).toContainText("0x1234…abcd");
  await expect(page.getByTestId("wrong-network")).toBeVisible();

  await page.getByRole("button", { name: "Switch to Robinhood Chain" }).click();
  await expect(page.getByTestId("wrong-network")).toBeHidden();
  await expect(chip).not.toContainText("Wrong network");

  await page.evaluate((a) => (window as unknown as { __mockWallet: { switchAccount(a: string): void } }).__mockWallet.switchAccount(a), ADDR_2);
  await expect(chip).toContainText("0x9999…9999");

  await page.evaluate(() => (window as unknown as { __mockWallet: { setChain(id: string): void } }).__mockWallet.setChain("0x89"));
  await expect(page.getByTestId("wrong-network")).toBeVisible();
});

test("a rejected connection shows a specific message", async ({ page }) => {
  await installMockWallet(page, { rejectConnect: true });
  await page.goto("/");
  await page.getByTestId("connect-wallet").click();
  await page.getByRole("button", { name: /Test Wallet/ }).click();
  await expect(page.getByText("Connection rejected in your wallet.")).toBeVisible();
});

test("no wallet installed shows install options", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("connect-wallet").click();
  await expect(page.getByText("No wallet detected in this browser")).toBeVisible();
  await expect(page.getByRole("link", { name: /Install MetaMask/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Install Rabby/ })).toBeVisible();
});
