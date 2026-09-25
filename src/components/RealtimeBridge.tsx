"use client";

import { useEffect } from "react";
import { api, notifyChanged } from "@/lib/api";
import { useSystem } from "./SystemProvider";

/** Connects to Azure Web PubSub (when configured) and turns server events into instant refreshes. */
export function RealtimeBridge() {
  // The live operation's group everywhere except /demo, which listens to this browser's sandbox.
  const { realtime, workspace } = useSystem();
  useEffect(() => {
    if (realtime !== "azure-web-pubsub") return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry = 1000;
    const connect = async () => {
      try {
        const { url } = await api<{ url: string }>("/api/realtime/negotiate");
        if (stopped) return;
        socket = new WebSocket(url);
        socket.onopen = () => (retry = 1000);
        socket.onmessage = () => notifyChanged();
        socket.onclose = () => {
          if (!stopped) setTimeout(() => void connect(), (retry = Math.min(retry * 2, 30000)));
        };
      } catch {
        if (!stopped) setTimeout(() => void connect(), (retry = Math.min(retry * 2, 30000)));
      }
    };
    void connect();
    return () => {
      stopped = true;
      socket?.close();
    };
  }, [realtime, workspace]);
  return null;
}
