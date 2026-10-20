import { useEffect, useState } from "react";
import { validateCatalog, type Catalog } from "./banners";
const CACHE_KEY = "rhodes-banner-catalog-v1";
function cached(): Catalog | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? validateCatalog(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function useBannerCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(cached);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(`${import.meta.env.BASE_URL}data/banners.json`, {
      signal: controller.signal,
      cache: "no-cache",
    })
      .then((r) => {
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((raw) => {
        let next = validateCatalog(raw);
        const old = cached();
        if (
          !next.events.length &&
          next.sync.status === "error" &&
          old?.events.length
        ) {
          next = { ...next, events: old.events };
          setError(
            "Đang dùng lịch hợp lệ gần nhất trên thiết bị vì bản đồng bộ hiện tại lỗi.",
          );
        }
        setCatalog(next);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch {
          /* Resource storage is independent. */
        }
      })
      .catch((e) => {
        if (!disposed)
          setError(
            `Không tải được lịch banner (${e instanceof Error ? e.message : "lỗi không xác định"}). Giữ dữ liệu đã lưu nếu có.`,
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!disposed) setLoading(false);
      });
    let disposed = false;
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
  return { catalog, loading, error };
}
