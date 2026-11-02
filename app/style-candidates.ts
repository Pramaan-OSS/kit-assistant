// The style switcher's candidates. Empty here, in the repository and on live sites: only Pramaan's
// preview build fills it, so the founder can compare styles on their own app.
export const styleCandidates: {
  names: readonly string[];
  vars: Readonly<Record<string, Readonly<Record<string, string>>>>;
} = { names: [], vars: {} };
