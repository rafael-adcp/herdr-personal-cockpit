// What a commit's check rollup means, in the two questions a row asks of it.
//
// Both pull request panels ask them, and a second definition of "a red build"
// is a second thing to keep in step -- which is exactly how the two panels
// drifted while they were two mod folders.
//
// Its own file because it is neither chrome nor layout: it is GitHub's
// vocabulary, and the empty import list above says so.

export const RED = (state) => state === "FAILURE" || state === "ERROR";
export const RUNNING = (state) => state === "PENDING" || state === "EXPECTED";
