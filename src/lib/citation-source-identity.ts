export interface CitationIdentityHint {
  sourceTitle?: string;
  paperShortName?: string;
}

export interface CitationSourceCandidate {
  id: string;
  title?: string;
  shortName?: string;
  fileName?: string;
}

export function resolveCitationSourceId(
  requestedId: string,
  hint: CitationIdentityHint,
  candidates: CitationSourceCandidate[],
): string {
  if (candidates.some(candidate => candidate.id === requestedId)) return requestedId;

  const identities = new Set(
    [requestedId, hint.sourceTitle, hint.paperShortName]
      .map(value => value?.trim().toLocaleLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  const matches = candidates.filter(candidate =>
    [candidate.id, candidate.title, candidate.shortName, candidate.fileName]
      .map(value => value?.trim().toLocaleLowerCase())
      .some(value => Boolean(value && identities.has(value))),
  );

  if (matches.length === 1) return matches[0].id;
  return requestedId;
}
