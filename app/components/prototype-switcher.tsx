// PROTOTYPE, never merge. Floating bottom bar that cycles `?variant=`.
// The choice is also kept in localStorage so it survives sidebar navigation
// (NavLinks drop the search string).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

const KEY = "prototype-variant";

export function usePrototypeVariant(keys: string[]) {
  const [params] = useSearchParams();
  const fromUrl = params.get("variant");
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    setStored(localStorage.getItem(KEY));
  }, [fromUrl]);
  const v = fromUrl ?? stored ?? keys[0];
  return keys.includes(v) ? v : keys[0];
}

export function PrototypeSwitcher({
  variants,
  current,
  extra,
}: {
  variants: { key: string; name: string }[];
  current: string;
  extra?: React.ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const i = variants.findIndex((v) => v.key === current);

  function go(delta: number) {
    const next = variants[(i + delta + variants.length) % variants.length].key;
    localStorage.setItem(KEY, next);
    const p = new URLSearchParams(params);
    p.set("variant", next);
    setParams(p, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]"))) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 text-sm text-white shadow-xl ring-2 ring-amber-400">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/20" aria-label="Previous variant">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-56 text-center font-mono">
        PROTOTYPE {variants[i].key} ({variants[i].name})
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/20" aria-label="Next variant">
        <ChevronRight className="size-4" />
      </button>
      {extra}
    </div>
  );
}
