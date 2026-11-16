// Shared tournament wording (used on server and client pages).
export const teamLabel = (size: number) =>
  size === 1 ? "Singles (1 v 1)" : size === 2 ? "Doubles (2 v 2)" : `Teams of ${size} (${size} v ${size})`;

/** What an entry is called: "player" for singles, "team" otherwise. */
export const entryWord = (teamSize: number, n: number) =>
  teamSize > 1 ? (n === 1 ? "team" : "teams") : n === 1 ? "player" : "players";

/**
 * How many stations one match takes. Same rule as public.stations_per_match in the database:
 * every player has their own PC; a console seats singles and doubles (bigger teams play one per
 * player); snooker, pool and the rest use one table per match. 0 = not linked to a station type.
 */
export function stationsPerMatch(type: string | null, teamSize: number) {
  if (!type) return 0;
  if (type === "pc") return 2 * teamSize;
  if (type === "ps5" || type === "xbox") return teamSize <= 2 ? 1 : 2 * teamSize;
  return 1;
}

/** Each player on their own station: the first half seats the top entry, the second half the bottom one. */
export const seatsPerSide = (type: string | null, teamSize: number) => stationsPerMatch(type, teamSize) > 1;
