"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/client/api";
import type { AreaLevel, MapPin, MarketDetail, Place, SearchResult } from "@/lib/market/types";
import { levelForMapZoom, type LevelChoice } from "@/lib/osm/parse";
import { WorldMap, type WorldMapHandle } from "@/components/map/WorldMap";
import { usableBBox } from "@/components/map/outline";
import { LiveFeed } from "@/components/app/LiveFeed";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { Notice } from "@/components/ui/Notice";
import { fmtPrice, fmtQuote, fmtWad } from "@/lib/format";
import { marketPath, suggestTicker } from "@/lib/validation/normalize";

type Point = { lat: number; lng: number };

type Selection =
  | { kind: "loading"; at: Point; label: string }
  | { kind: "place"; at: Point | null; place: Place; levels: LevelChoice[]; level: AreaLevel | null }
  | { kind: "market"; market: MarketDetail }
  | { kind: "empty"; at: Point; message: string };

const LEVEL_NAMES: Record<AreaLevel, string> = {
  country: "Country",
  state: "State / region",
  county: "County",
  city: "City",
  town: "Town",
  suburb: "Neighbourhood",
  neighbourhood: "Neighbourhood",
};

function markerOf(sel: Selection | null): Point | null {
  if (!sel) return null;
  if (sel.kind === "loading" || sel.kind === "empty") return sel.at;
  if (sel.kind === "place") return sel.at ?? { lat: sel.place.lat, lng: sel.place.lng };
  return { lat: sel.market.lat, lng: sel.market.lng };
}

export function MapHome() {
  const mapRef = useRef<WorldMapHandle>(null);
  const params = useSearchParams();
  const [sel, setSel] = useState<Selection | null>(null);
  const [outline, setOutline] = useState<unknown | null>(null);
  const [zoom, setZoom] = useState(1.4);
  const reqId = useRef(0);

  const pins = useQuery({
    queryKey: ["pins"],
    queryFn: () => api<{ items: MapPin[] }>("/api/map/pins?limit=2000"),
    refetchInterval: 30_000,
  });

  const loadOutline = useCallback(async (placeId: string, id: number) => {
    try {
      const r = await api<{ geometry: unknown }>(`/api/places/${placeId}/outline`);
      if (id === reqId.current) setOutline(r.geometry);
    } catch {
      /* the border is decorative */
    }
  }, []);

  const showPlace = useCallback((place: Place, at: Point | null, levels: LevelChoice[], level: AreaLevel | null, id: number, fit: boolean) => {
    setSel({ kind: "place", at, place, levels, level });
    const bb = usableBBox(place.bbox);
    if (fit && bb) mapRef.current?.fitBounds(bb);
    void loadOutline(place.id, id);
  }, [loadOutline]);

  const pickAt = useCallback(async (at: Point, level: AreaLevel, fit: boolean) => {
    const id = ++reqId.current;
    setOutline(null);
    setSel({ kind: "loading", at, label: `Finding the ${LEVEL_NAMES[level].toLowerCase()} here…` });
    try {
      const r = await api<{ place: Place | null; levels: LevelChoice[] }>("/api/places/at", { method: "POST", json: { ...at, level } });
      if (id !== reqId.current) return;
      if (!r.place) {
        setSel({ kind: "empty", at, message: "There is no area to tokenize here — try clicking on land, or zoom out to pick a bigger area." });
        return;
      }
      showPlace(r.place, at, r.levels, level, id, fit);
    } catch (err) {
      if (id === reqId.current) setSel({ kind: "empty", at, message: err instanceof ApiClientError ? err.message : "Something went wrong. Try again." });
    }
  }, [showPlace]);

  const openMarket = useCallback(async (slug: string) => {
    const id = ++reqId.current;
    setOutline(null);
    try {
      const m = await api<MarketDetail>(`/api/markets/${encodeURIComponent(slug)}`);
      if (id !== reqId.current) return;
      setSel({ kind: "market", market: m });
      const bb = usableBBox(m.bbox);
      if (bb) mapRef.current?.fitBounds(bb);
      else mapRef.current?.flyTo(m.lat, m.lng, 10);
      void loadOutline(m.placeId, id);
    } catch (err) {
      if (id === reqId.current) setSel({ kind: "empty", at: { lat: 0, lng: 0 }, message: (err as Error).message });
    }
  }, [loadOutline]);

  const pickSearch = useCallback(async (r: SearchResult) => {
    if (!r.place) {
      if (r.bbox) mapRef.current?.fitBounds(r.bbox);
      else mapRef.current?.flyTo(r.lat, r.lng, 12);
      return;
    }
    const id = ++reqId.current;
    setOutline(null);
    setSel({ kind: "loading", at: { lat: r.lat, lng: r.lng }, label: r.label });
    try {
      const place = await api<Place>("/api/places/resolve", { method: "POST", json: { sourceId: r.place.sourceId } });
      if (id !== reqId.current) return;
      showPlace(place, null, [], null, id, true);
    } catch (err) {
      if (id === reqId.current) setSel({ kind: "empty", at: { lat: r.lat, lng: r.lng }, message: (err as Error).message });
    }
  }, [showPlace]);

  // /app?place=<id> — open a place (links from market pages and the tokenize page)
  const placeParam = params.get("place");
  useEffect(() => {
    if (!placeParam || !/^[0-9a-f-]{36}$/i.test(placeParam)) return;
    const id = ++reqId.current;
    api<Place>(`/api/places/${placeParam}`)
      .then((p) => {
        if (id !== reqId.current) return;
        setTimeout(() => showPlace(p, null, [], null, id, true), 300);
      })
      .catch(() => undefined);
  }, [placeParam, showPlace]);

  const tokenized = pins.data?.items.length ?? 0;
  const close = () => {
    reqId.current++;
    setSel(null);
    setOutline(null);
  };

  return (
    <div className="map-home">
      <WorldMap
        ref={mapRef}
        pins={pins.data?.items ?? []}
        selected={markerOf(sel)}
        outline={outline}
        onPinClick={openMarket}
        onMapClick={(p) => void pickAt({ lat: p.lat, lng: p.lng }, levelForMapZoom(p.zoom), false)}
        onZoom={setZoom}
      />

      <div className="map-top">
        <SearchBox onPick={pickSearch} />
      </div>

      {!sel ? (
        <div className="map-hint map-hint-soft">
          Click anywhere to pick a {levelForMapZoom(zoom) === "country" ? "country" : levelForMapZoom(zoom) === "state" ? "state or region" : levelForMapZoom(zoom) === "city" ? "city" : "town or neighbourhood"} — zoom in for smaller areas
        </div>
      ) : null}

      <aside className="map-side">
        <div className="map-stat">
          <strong>{tokenized.toLocaleString()}</strong>
          <span>places tokenized</span>
        </div>
        <LiveFeed />
      </aside>

      {sel ? (
        <div className="place-sheet" role="dialog" aria-label="Selected place">
          <button type="button" className="place-close" aria-label="Close" onClick={close}>✕</button>
          {sel.kind === "loading" ? (
            <div className="stack">
              <div className="sheet-title">{sel.label}</div>
              <div className="row small muted"><span className="spinner" aria-hidden /> Looking it up on OpenStreetMap…</div>
            </div>
          ) : null}
          {sel.kind === "empty" ? <Notice tone="warn">{sel.message}</Notice> : null}
          {sel.kind === "place" ? (
            <PlaceSheet
              sel={sel}
              onLevel={(level) => sel.at && void pickAt(sel.at, level, true)}
              onOpenMarket={openMarket}
            />
          ) : null}
          {sel.kind === "market" ? <MarketSheet m={sel.market} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SearchBox({ onPick }: { onPick(r: SearchResult): void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Searches run on Enter / the button only (no search-as-you-type: OpenStreetMap's usage policy).
  async function run() {
    const term = q.trim();
    if (term.length < 2 || busy) return;
    setBusy(true);
    setOpen(true);
    try {
      const r = await api<{ items: SearchResult[] }>(`/api/places/search?${new URLSearchParams({ q: term })}`);
      setItems(r.items);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="map-search">
      <form className="map-search-box" role="search" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          aria-label="Search any country, city or neighbourhood"
          placeholder="Search a country, city or neighbourhood — e.g. New York"
          value={q}
          onChange={(e) => { setQ(e.target.value); if (!e.target.value) { setItems(null); setError(null); } }}
          onFocus={() => setOpen(true)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 2}>
          {busy ? <span className="spinner" aria-hidden /> : "Search"}
        </button>
      </form>
      {open && (items || error) ? (
        <ul className="map-search-results" role="listbox">
          {error ? <li className="muted small">{error}</li> : null}
          {items?.length === 0 ? <li className="muted small">Nothing found. Try another spelling.</li> : null}
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

function PlaceSheet({ sel, onLevel, onOpenMarket }: {
  sel: Extract<Selection, { kind: "place" }>;
  onLevel(level: AreaLevel): void;
  onOpenMarket(slug: string): void;
}) {
  const p = sel.place;
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div className="sheet-avatar" aria-hidden>{p.countryCode ? flagOf(p.countryCode) : p.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div className="sheet-title">{p.name}</div>
          <div className="small muted">{[p.placeType, p.region].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      {sel.levels.length > 1 && sel.at ? (
        <div className="level-chips" role="group" aria-label="Pick a bigger or smaller area">
          {sel.levels.map((l) => (
            <button
              key={`${l.level}-${l.label}`}
              type="button"
              className="level-chip"
              aria-pressed={l.label === p.name}
              onClick={() => onLevel(l.level)}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}
      {p.hidden ? (
        <Notice tone="info">This place is not listed on mapin.</Notice>
      ) : p.market ? (
        <button type="button" className="btn btn-primary btn-lg" onClick={() => onOpenMarket(p.slug)}>View ${p.market.symbol}</button>
      ) : (
        <>
          <div className="sheet-ticker">
            <span className="small muted">Suggested ticker</span>
            <strong className="mono">${suggestTicker(p.name)}</strong>
            <span className="tiny muted">editable</span>
          </div>
          <Link className="btn btn-primary btn-lg" href={`/tokenize/${p.id}`}>Tokenize {p.name}</Link>
          <p className="tiny muted" style={{ margin: 0 }}>Not tokenized yet — be the first. One place, one token.</p>
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
          <div className="sheet-title">{m.placeName}</div>
          <div className="small muted">{[m.placeType, m.region].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <span className="badge badge-black" style={{ alignSelf: "flex-start" }}>${m.symbol}</span>
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

/** "US" → 🇺🇸 */
function flagOf(code: string): string {
  const cc = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🌍";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
