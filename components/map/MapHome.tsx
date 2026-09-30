"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { api, ApiClientError } from "@/lib/client/api";
import type { Business, MapPin, MarketDetail, SearchResult } from "@/lib/market/types";
import { WorldMap, type WorldMapHandle } from "@/components/map/WorldMap";
import { LiveFeed } from "@/components/app/LiveFeed";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { Notice } from "@/components/ui/Notice";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { useIsSignedIn, useWalletSignIn } from "@/hooks/useSession";
import { OWNER_FEE_BPS } from "@/lib/config/public";
import { fmtPrice, fmtQuote, fmtWad, safeHttpUrl } from "@/lib/format";
import { marketPath, suggestTicker } from "@/lib/validation/normalize";

type Selection =
  | { kind: "loading"; lat: number; lng: number; label: string | null }
  | { kind: "business"; business: Business }
  | { kind: "market"; market: MarketDetail }
  | { kind: "error"; message: string; lat: number; lng: number }
  | { kind: "add"; lat: number; lng: number };

const CATEGORIES = [
  "Restaurant", "Cafe", "Street food", "Bar", "Bakery", "Grocery", "Clothes shop", "Barber", "Salon", "Hotel", "Workshop",
  "Pharmacy", "Gym", "Office", "Market stall", "Other",
];

function selectedPoint(sel: Selection | null): { lat: number; lng: number } | null {
  if (!sel) return null;
  if (sel.kind === "business") return { lat: sel.business.lat, lng: sel.business.lng };
  if (sel.kind === "market") return { lat: sel.market.lat, lng: sel.market.lng };
  return { lat: sel.lat, lng: sel.lng };
}

export function MapHome() {
  const mapRef = useRef<WorldMapHandle>(null);
  const params = useSearchParams();
  const [sel, setSel] = useState<Selection | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [zoom, setZoom] = useState(1.4);
  const reqId = useRef(0);

  const pins = useQuery({
    queryKey: ["pins"],
    queryFn: () => api<{ items: MapPin[] }>("/api/map/pins?limit=2000"),
    refetchInterval: 30_000,
  });

  const resolve = useCallback(async (body: unknown, at: { lat: number; lng: number; label: string | null }) => {
    const id = ++reqId.current;
    setSel({ kind: "loading", ...at });
    try {
      const b = await api<Business>("/api/businesses/resolve", { method: "POST", json: body });
      if (id !== reqId.current) return;
      setSel({ kind: "business", business: b });
    } catch (err) {
      if (id !== reqId.current) return;
      setSel({ kind: "error", message: err instanceof ApiClientError ? err.message : "Something went wrong. Try again.", lat: at.lat, lng: at.lng });
    }
  }, []);

  const openMarket = useCallback(async (slug: string) => {
    const id = ++reqId.current;
    try {
      const m = await api<MarketDetail>(`/api/markets/${encodeURIComponent(slug)}`);
      if (id !== reqId.current) return;
      setSel({ kind: "market", market: m });
      mapRef.current?.flyTo(m.lat, m.lng, Math.max(mapRef.current.center()?.zoom ?? 0, 16));
    } catch (err) {
      if (id === reqId.current) setSel({ kind: "error", message: (err as Error).message, lat: 0, lng: 0 });
    }
  }, []);

  // /?place=<business id> — open a business (links from market pages, tokenize wizard)
  const placeParam = params.get("place");
  useEffect(() => {
    if (!placeParam || !/^[0-9a-f-]{36}$/i.test(placeParam)) return;
    let alive = true;
    api<Business>(`/api/businesses/${placeParam}`)
      .then((b) => {
        if (!alive) return;
        setSel({ kind: "business", business: b });
        setTimeout(() => mapRef.current?.flyTo(b.lat, b.lng, 17), 400);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [placeParam]);

  const onPoiClick = useCallback((p: { lat: number; lng: number; label: string | null }) => {
    void resolve({ kind: "click", lat: p.lat, lng: p.lng, label: p.label ?? undefined }, p);
  }, [resolve]);

  const onPointPick = useCallback((p: { lat: number; lng: number }) => {
    reqId.current++;
    setSel({ kind: "add", ...p });
  }, []);

  const pickSearch = useCallback((r: SearchResult) => {
    if (r.place) {
      mapRef.current?.flyTo(r.lat, r.lng, 18);
      void resolve({ kind: "osm", sourceId: r.place.sourceId }, { lat: r.lat, lng: r.lng, label: r.place.name });
    } else if (r.bbox) {
      mapRef.current?.fitBounds(r.bbox);
    } else {
      mapRef.current?.flyTo(r.lat, r.lng, 15);
    }
  }, [resolve]);

  const tokenized = pins.data?.items.length ?? 0;

  return (
    <div className="map-home">
      <WorldMap
        ref={mapRef}
        pins={pins.data?.items ?? []}
        selected={selectedPoint(sel)}
        addMode={addMode}
        onPinClick={openMarket}
        onPoiClick={onPoiClick}
        onPointPick={onPointPick}
        onEmptyClick={() => setSel(null)}
        onZoom={setZoom}
      />

      <div className="map-top">
        <SearchBox onPick={pickSearch} near={() => mapRef.current?.center() ?? null} />
        <button
          type="button"
          className={`btn map-add-btn${addMode ? " is-on" : ""}`}
          aria-pressed={addMode}
          onClick={() => {
            setAddMode((v) => !v);
            if (addMode && sel?.kind === "add") setSel(null);
          }}
        >
          {addMode ? "✕ Cancel" : "＋ Add a business"}
        </button>
      </div>

      {addMode && sel?.kind !== "add" ? <div className="map-hint">Tap the exact spot of the business on the map</div> : null}
      {!addMode && !sel && zoom < 14 ? (
        <div className="map-hint map-hint-soft">Search a place or zoom in — tap any shop, café or restaurant to tokenize it</div>
      ) : null}

      <aside className="map-side">
        <div className="map-stat">
          <strong>{tokenized.toLocaleString()}</strong>
          <span>businesses on the map</span>
        </div>
        <div className="map-legend">
          <span><i className="dot dot-accent" /> tokenized</span>
          <span><i className="dot dot-green" /> claimed by owner</span>
        </div>
        <LiveFeed />
      </aside>

      {sel ? (
        <div className="place-sheet" role="dialog" aria-label="Selected place">
          <button type="button" className="place-close" aria-label="Close" onClick={() => { reqId.current++; setSel(null); }}>✕</button>
          {sel.kind === "loading" ? (
            <div className="stack">
              <div className="sheet-title">{sel.label ?? "Looking up this place…"}</div>
              <div className="row small muted"><span className="spinner" aria-hidden /> Finding it on OpenStreetMap…</div>
            </div>
          ) : null}
          {sel.kind === "error" ? (
            <div className="stack">
              <Notice tone="warn">{sel.message}</Notice>
              {sel.lat || sel.lng ? (
                <button type="button" className="btn btn-primary" onClick={() => { setAddMode(true); setSel({ kind: "add", lat: sel.lat, lng: sel.lng }); }}>
                  ＋ Add a business here
                </button>
              ) : null}
            </div>
          ) : null}
          {sel.kind === "business" ? <BusinessSheet b={sel.business} onOpenMarket={openMarket} /> : null}
          {sel.kind === "market" ? <MarketSheet m={sel.market} /> : null}
          {sel.kind === "add" ? (
            <AddBusinessForm
              lat={sel.lat}
              lng={sel.lng}
              onDone={(b) => {
                setAddMode(false);
                setSel({ kind: "business", business: b });
                void pins.refetch();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SearchBox({ onPick, near }: { onPick(r: SearchResult): void; near(): { lat: number; lng: number } | null }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setItems(null);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const c = nearRef.current();
        const qs = new URLSearchParams({ q: term });
        if (c) {
          qs.set("lat", c.lat.toFixed(4));
          qs.set("lng", c.lng.toFixed(4));
        }
        const r = await api<{ items: SearchResult[] }>(`/api/places/search?${qs}`);
        setItems(r.items);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="map-search">
      <label className="map-search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          aria-label="Search any business, street or city"
          placeholder="Search any business, street or city on earth"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {busy ? <span className="spinner" aria-hidden /> : null}
      </label>
      {open && (items || error) ? (
        <ul className="map-search-results" role="listbox">
          {error ? <li className="muted small">{error}</li> : null}
          {items?.length === 0 ? <li className="muted small">Nothing found. Try another spelling, or add the business yourself.</li> : null}
          {items?.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button type="button" onClick={() => { setOpen(false); onPick(r); }}>
                <span className="res-icon" aria-hidden>{r.place ? "📍" : "🗺️"}</span>
                <span className="res-text">
                  <strong>{r.label}</strong>
                  <span className="small muted">{r.sublabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BusinessSheet({ b, onOpenMarket }: { b: Business; onOpenMarket(slug: string): void }) {
  const where = [b.address, b.city, b.country].filter(Boolean).join(", ");
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div className="sheet-avatar" aria-hidden>{b.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div className="sheet-title">{b.name}</div>
          <div className="small muted">{[b.category, where].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge">{b.claimed ? "✓ Claimed" : "Unofficial"}</span>
        <span className="badge">{b.market ? `Tokenized · $${b.market.symbol}` : "Not tokenized yet"}</span>
      </div>
      {safeHttpUrl(b.website) ? (
        <a className="small" href={safeHttpUrl(b.website)!} target="_blank" rel="noopener noreferrer nofollow">{b.website}</a>
      ) : null}
      {b.hidden ? (
        <Notice tone="info">The owner asked for this place not to be listed on mapin.</Notice>
      ) : b.market ? (
        <button type="button" className="btn btn-primary btn-lg" onClick={() => onOpenMarket(b.slug)}>View ${b.market.symbol}</button>
      ) : (
        <>
          <div className="sheet-ticker">
            <span className="small muted">Suggested ticker</span>
            <strong className="mono">${suggestTicker(b.name)}</strong>
            <span className="tiny muted">you can change it</span>
          </div>
          <Link className="btn btn-primary btn-lg" href={`/tokenize/${b.id}`}>Tokenize this business</Link>
          <p className="tiny muted" style={{ margin: 0 }}>{OWNER_FEE_BPS / 100}% of every trade is held for the owner until they claim it.</p>
        </>
      )}
    </div>
  );
}

function MarketSheet({ m }: { m: MarketDetail }) {
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <TokenLogo src={m.imageUrl} symbol={m.symbol} />
        <div style={{ minWidth: 0 }}>
          <div className="sheet-title">{m.businessName}</div>
          <div className="small muted">{[m.category, m.city, m.country].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge badge-black">${m.symbol}</span>
        <span className={`badge ${m.claimed ? "badge-green" : ""}`}>{m.claimed ? "✓ Claimed" : "Unofficial"}</span>
      </div>
      <dl className="kv">
        <dt>Price</dt><dd>{fmtPrice(m.priceWad, m.quoteSymbol)}</dd>
        <dt>Market cap</dt><dd>{fmtWad(m.marketCapWad, m.quoteSymbol)}</dd>
        <dt>24h volume</dt><dd>{fmtQuote(m.volume24h, m.quoteDecimals, m.quoteSymbol)}</dd>
        <dt>Holders</dt><dd>{m.holders ?? "—"}</dd>
      </dl>
      <Link className="btn btn-primary btn-lg" href={marketPath(m.slug)}>Trade ${m.symbol}</Link>
    </div>
  );
}

function AddBusinessForm({ lat, lng, onDone }: { lat: number; lng: number; onDone(b: Business): void }) {
  const { isConnected } = useConnection();
  const signedIn = useIsSignedIn();
  const { signIn, pending: signing, error: signError } = useWalletSignIn();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Restaurant");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const b = await api<Business>("/api/businesses/resolve", {
        method: "POST",
        json: { kind: "manual", lat, lng, name, category, address, website },
      });
      onDone(b);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sheet-title">Add a business</div>
      <div className="tiny muted mono">{lat.toFixed(5)}, {lng.toFixed(5)} · tap the map again to move the pin</div>
      <div className="field">
        <label className="label" htmlFor="add-name">Business name</label>
        <input id="add-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Warung Bu Tini" />
      </div>
      <div className="field">
        <label className="label" htmlFor="add-cat">Type</label>
        <select id="add-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="add-addr">Street / area (optional)</label>
        <input id="add-addr" className="input" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="add-web">Website (optional)</label>
        <input id="add-web" className="input" maxLength={200} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
      </div>
      {!isConnected ? (
        <>
          <p className="small" style={{ margin: 0 }}>Connect a wallet to add places to the map.</p>
          <ConnectButton />
        </>
      ) : !signedIn ? (
        <button type="button" className="btn btn-primary" disabled={signing} onClick={() => signIn()}>
          {signing ? <span className="spinner" aria-hidden /> : null} Sign in with wallet
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-lg" disabled={busy || name.trim().length < 2} onClick={save}>
          {busy ? <span className="spinner" aria-hidden /> : null} Put it on the map
        </button>
      )}
      {signError ? <Notice tone="error">{signError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
