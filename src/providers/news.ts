import type { OperationalEvent } from "@/domain/ops";
import { lookupPlace } from "@/maps/gazetteer";
import { fetchText, isoOrUndef, liveEvent, type LiveProvider } from "./types";

/**
 * Local news RSS — Tier 1 (NEWS_RSS_URLS, comma-separated).
 *
 * News is MEDIA_REPORT authority and always UNVERIFIED: it is shown for
 * awareness and review but can never close a road or hold a mission alone
 * (correlation rule A3). Items are located only by a known place name.
 */

const RELEVANT = /\b(?:clos(?:ed|ure)|flood\w*|crash|collision|tree down|trees down|power (?:outage|lines?)|evacuat\w*|shelter|tornado|washed out|high water|downed)\b/i;
const MAX_AGE_H = 12;

const tag = (xml: string, name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1];
const clean = (s?: string) =>
  s
    ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Stable id from the whole link + title (a URL prefix would collide per outlet). */
function hashId(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + s.charCodeAt(i), 2654435761);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Pure parser — exported for tests. */
export function parseNewsRss(xml: string, feedName: string, now: Date): OperationalEvent[] {
  const out: OperationalEvent[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    try {
    const item = m[0];
    const title = clean(tag(item, "title"));
    if (!title || !RELEVANT.test(title)) continue;
    const at = isoOrUndef(clean(tag(item, "pubDate")) ?? clean(tag(item, "dc:date")));
    if (at && now.getTime() - Date.parse(at) > MAX_AGE_H * 3600e3) continue;
    const desc = clean(tag(item, "description"));
    const place = lookupPlace(title) ?? (desc ? lookupPlace(desc) : undefined);
    if (!place) continue;
    const link = clean(tag(item, "link"));
    out.push(
      liveEvent({
        id: `news-${hashId(`${link ?? ""}|${title}`)}`,
        type: "NEWS_REPORT",
        category: "NEWS",
        sourceId: `news-${feedName}`,
        sourceName: feedName,
        sourceType: "NEWS",
        authorityLevel: "MEDIA_REPORT",
        verificationStatus: "UNVERIFIED",
        title: title.slice(0, 160),
        description: desc?.slice(0, 300),
        geometry: { type: "Point", coordinates: [place.point.lng, place.point.lat] },
        eventTime: at,
        fetchedAt: now.toISOString(),
        effects: /\bclos(?:ed|ure)|washed out|impassable\b/i.test(title) ? [{ kind: "BLOCKS_ROAD", radiusM: 300 }] : [{ kind: "ADVISORY" }],
      }, { raw: item, sourceUrl: link && /^https:\/\//.test(link) ? link : undefined, sourceUpdatedAt: at }),
    );
    } catch {
      // One malformed item never takes down the whole feed.
    }
  }
  return out;
}

export const newsProvider: LiveProvider = {
  id: "news",
  name: "Local news (RSS)",
  category: "NEWS",
  tier: 1,
  liveState: "LIVE_DELAYED",
  pollSeconds: 600,
  describes: "Media reports for situational awareness. Unverified — never actionable on its own.",
  unavailable: () => (process.env.NEWS_RSS_URLS ? null : { state: "NOT_CONFIGURED", detail: "Set NEWS_RSS_URLS to one or more local news RSS feeds." }),
  async fetchEvents(now) {
    const urls = process.env.NEWS_RSS_URLS!.split(",").map((u) => u.trim()).filter(Boolean).slice(0, 5);
    const results = await Promise.allSettled(urls.map(async (u) => parseNewsRss(await fetchText(u), new URL(u).host, now)));
    const ok = results.filter((r): r is PromiseFulfilledResult<OperationalEvent[]> => r.status === "fulfilled");
    if (!ok.length && results.length) throw (results[0] as PromiseRejectedResult).reason;
    return ok.flatMap((r) => r.value);
  },
};
