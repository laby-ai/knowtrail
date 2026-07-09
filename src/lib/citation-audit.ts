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
  status: 'pass' | 'missing-required-sections' | 'missing-claim-citations';
  requiredSections: string[];
  missingSections: string[];
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

export function auditCitationSectionCoverage(
  answer: string,
  requiredSections: string[],
): CitationSectionCoverageResult {
  const seenSections = new Set<string>();
  const uncitedClaims: CitationCoverageClaim[] = [];
  let activeSection: string | undefined;

  for (const [index, rawLine] of answer.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const normalizedHeading = normalizeSectionHeading(line);
    const matchedSection = requiredSections.find(section => normalizedHeading === section);
    if (matchedSection) {
      activeSection = matchedSection;
      seenSections.add(matchedSection);
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      activeSection = undefined;
      continue;
    }
    if (!activeSection) continue;

    const claimText = line.replace(/^[-*+]\s+/, '').replace(/^>\s*/, '').trim();
    if (claimText.length < 4) continue;
    if (!/\[\d{1,3}\]/.test(claimText)) {
      uncitedClaims.push({ section: activeSection, line: index + 1, text: claimText });
    }
  }

  const missingSections = requiredSections.filter(section => !seenSections.has(section));
  return {
    status: missingSections.length > 0
      ? 'missing-required-sections'
      : uncitedClaims.length > 0 ? 'missing-claim-citations' : 'pass',
    requiredSections,
    missingSections,
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
