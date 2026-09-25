"use client";

import { api, ApiError } from "./api";

/**
 * Switch the acting persona. In a shared operation, becoming a coordinator
 * asks for the coordinator passcode; declining leaves the persona unchanged.
 */
export async function signInAs(persona: string, opts: { silent?: boolean } = {}): Promise<boolean> {
  try {
    await api("/api/persona", { body: { persona } });
    return true;
  } catch (e) {
    if (!(e instanceof ApiError) || !(e.details as { passcodeRequired?: boolean } | undefined)?.passcodeRequired || opts.silent) {
      if (opts.silent) return false;
      throw e;
    }
    const passcode = window.prompt("Coordinator passcode for this shared operation:");
    if (!passcode) return false;
    await api("/api/persona", { body: { persona, passcode } });
    return true;
  }
}
