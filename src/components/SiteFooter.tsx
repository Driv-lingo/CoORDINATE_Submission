"use client";

import { useSystem } from "./SystemProvider";

/** Footer disclaimer: the exercise is fictional; /live shows real public feeds. */
export function SiteFooter() {
  const live = useSystem().mode === "live";
  return (
    <footer className="border-t border-line bg-white px-4 py-3 text-center text-xs text-muted">
      CoORDINATE prototype — Microsoft &amp; CCI Innovation Challenge for Virginia.{" "}
      {live ? "Live operation: real requests and volunteers, and public feeds shown as published by their sources. Simulated exercise at /demo." : "Fictional scenario and simulated feeds."} CoORDINATE never contacts 911,
      utilities or authorities itself — it recommends escalation to a coordinator. <strong>In a real emergency, call 911.</strong>
    </footer>
  );
}
