// Shared tournament wording (used on server and client pages).
export const teamLabel = (size: number) =>
  size === 1 ? "Singles (1 v 1)" : size === 2 ? "Doubles (2 v 2)" : `Teams of ${size} (${size} v ${size})`;

/** What an entry is called: "player" for singles, "team" otherwise. */
export const entryWord = (teamSize: number, n: number) =>
  teamSize > 1 ? (n === 1 ? "team" : "teams") : n === 1 ? "player" : "players";
