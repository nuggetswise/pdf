"use server";
// Server action behind every screen action. The run travels with the call and comes back changed; see
// lib/server/run-action.ts. The browser cannot reach the Gemini key or any other server setting through it.
import { type ActionResult, applyAction } from "../../lib/server/run-action";

export async function runAction(state: unknown, action: unknown): Promise<ActionResult> {
  return applyAction(state, action);
}
