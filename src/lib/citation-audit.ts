import type { GroundedCitation } from '@/lib/rag';

export type CitationAuditStatus = 'none' | 'pass' | 'missing-markers' | 'invalid-markers';

export interface CitationAuditResult {
  status: CitationAuditStatus;
  citedNumbers: number[];
  invalidNumbers: number[];
  uncitedNumbers: number[];
  citationCount: number;
  markerCount: number;
  warning?: string;
}

export interface CitationCoverageClaim {
  section: string;
  line: number;
  text: string;
}

export interface CitationSectionCoverageResult {
  status: 'pass' | 'missing-required-sections' | 'missing-section-claims' | 'missing-claim-citations';
  requiredSections: string[];
  missingSections: string[];
  emptySections: string[];
  uncitedClaims: CitationCoverageClaim[];
}

function normalizeSectionHeading(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+(?:\.\d+)*[.)、]\s*/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/[：:]$/, '')
    .trim();
}

function parseMarkdownHeading(line: string): { level: number; text: string } | undefined {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  if (!match) return undefined;
  return { level: match[1].length, text: normalizeSectionHeading(match[2]) };
}

function splitSubstantiveClaims(line: string): string[] {
  const claimText = line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .replace(/^>\s*/, '')
    .trim();
  if (!claimText) return [];

  const protectedPeriod = '\uE000';
  const citationAwareText = claimText
    .replace(/\b(?:et al|e\.g|i\.e|cf|vs|Fig|Eq|Dr|Prof)\./gi, match => match.replaceAll('.', protectedPeriod))
    .replace(/\b[A-Z]\.(?=\s*(?:[A-Z]\.\s*)*[A-Z][a-z])/g, match => match.replace('.', protectedPeriod));

  return citationAwareText
    .split(/(?<=[。！？；])|(?<=[.!?;])\s+/)
    .map(claim => claim.replaceAll(protectedPeriod, '.').trim())
    .filter(claim => claim.length >= 4);
}

export function auditCitationSectionCoverage(
  answer: string,
  requiredSections: string[],
): CitationSectionCoverageResult {
  const seenSections = new Set<string>();
  const claimCounts = new Map<string, number>();
  const uncitedClaims: CitationCoverageClaim[] = [];
  let activeSection: string | undefined;
  let activeSectionHeadingLevel: number | undefined;

  for (const [index, rawLine] of answer.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const markdownHeading = parseMarkdownHeading(line);
    const normalizedHeading = markdownHeading?.text ?? normalizeSectionHeading(line);
    const matchedSection = requiredSections.find(section => normalizedHeading === section);
    if (matchedSection) {
      activeSection = matchedSection;
      activeSectionHeadingLevel = markdownHeading?.level ?? 1;
      seenSections.add(matchedSection);
      continue;
    }

    if (markdownHeading) {
      if (activeSectionHeadingLevel === undefined || markdownHeading.level <= activeSectionHeadingLevel) {
        activeSection = undefined;
        activeSectionHeadingLevel = undefined;
      }
      continue;
    }
    if (!activeSection) continue;

    const claims = splitSubstantiveClaims(line);
    claimCounts.set(activeSection, (claimCounts.get(activeSection) ?? 0) + claims.length);
    for (const claim of claims) {
      if (!/\[\d{1,3}\]/.test(claim)) {
        uncitedClaims.push({ section: activeSection, line: index + 1, text: claim });
      }
    }
  }

  const missingSections = requiredSections.filter(section => !seenSections.has(section));
  const emptySections = requiredSections.filter(section => seenSections.has(section) && !claimCounts.get(section));
  return {
    status: missingSections.length > 0
      ? 'missing-required-sections'
      : emptySections.length > 0
        ? 'missing-section-claims'
        : uncitedClaims.length > 0 ? 'missing-claim-citations' : 'pass',
    requiredSections,
    missingSections,
    emptySections,
    uncitedClaims,
  };
}

export function auditCitationMarkers(answer: string, citations: GroundedCitation[]): CitationAuditResult {
  const citationCount = citations.length;
  const citedNumbers = Array.from(
    new Set([...answer.matchAll(/\[(\d{1,3})\]/g)].map(match => Number(match[1]))),
  ).sort((a, b) => a - b);
  const validNumbers = new Set(Array.from({ length: citationCount }, (_, index) => index + 1));
  const invalidNumbers = citedNumbers.filter(number => !validNumbers.has(number));
  const uncitedNumbers = Array.from(validNumbers).filter(number => !citedNumbers.includes(number));

  if (citationCount === 0) {
    return {
      status: 'none',
      citedNumbers,
      invalidNumbers,
      uncitedNumbers: [],
      citationCount,
      markerCount: citedNumbers.length,
    };
  }

  if (citedNumbers.length === 0) {
    return {
      status: 'missing-markers',
      citedNumbers,
      invalidNumbers,
      uncitedNumbers,
      citationCount,
      markerCount: 0,
      warning: '模型输出没有使用任何引用编号，前端应提示用户该回答未完成来源对齐。',
    };
  }

  if (invalidNumbers.length > 0) {
    return {
      status: 'invalid-markers',
      citedNumbers,
      invalidNumbers,
      uncitedNumbers,
      citationCount,
      markerCount: citedNumbers.length,
      warning: `模型输出包含不存在的引用编号：${invalidNumbers.map(number => `[${number}]`).join(', ')}`,
    };
  }

  return {
    status: 'pass',
    citedNumbers,
    invalidNumbers,
    uncitedNumbers,
    citationCount,
    markerCount: citedNumbers.length,
  };
}
