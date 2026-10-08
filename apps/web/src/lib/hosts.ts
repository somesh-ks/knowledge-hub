/**
 * The two voices of an episode, as named characters. Every place the app shows who is speaking
 * reads them from here, so a person is the same Ada or Leo on every screen.
 *
 * "a" leads the conversation; "b" joins it. A readout or a headlines episode has one voice, and
 * it is Ada's. The accent is a tone name: player.css maps it to existing colour tokens.
 */
export type HostKey = "a" | "b";

export interface Host {
  key: HostKey;
  name: string;
  /** The letter in the round badge, so the two differ by more than colour. */
  initial: string;
  tone: "lead" | "guest";
}

export const HOSTS: Record<HostKey, Host> = {
  a: { key: "a", name: "Ada", initial: "A", tone: "lead" },
  b: { key: "b", name: "Leo", initial: "L", tone: "guest" },
};

export function hostOf(speaker: string): Host {
  return speaker === "b" ? HOSTS.b : HOSTS.a;
}
