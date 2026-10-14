import { TokenPage } from "@/components/countries/TokenPage";

export const metadata = { title: "Token" };

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <TokenPage address={decodeURIComponent(address)} />;
}
