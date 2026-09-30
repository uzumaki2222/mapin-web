import { Logo } from "@/components/ui/Logo";

export default function Loading() {
  return (
    <div className="loading-screen" role="status" aria-label="Loading">
      <Logo height={60} />
      <span className="spinner" aria-hidden />
    </div>
  );
}
