import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <div className="container section center stack" style={{ alignItems: "center" }}>
      <Logo height={48} />
      <h1>404</h1>
      <p className="muted">This page or market does not exist.</p>
      <div className="row">
        <Link className="btn btn-primary" href="/explore">Explore markets</Link>
        <Link className="btn" href="/create">Create a market</Link>
      </div>
    </div>
  );
}
