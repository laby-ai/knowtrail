import { BookOpen, GitBranch, FileCheck2 } from 'lucide-react';

/** Decorative illustration, never presented as a user's actual citation graph. */
export function ResearchNetwork() {
  return (
    <div className="research-network" aria-hidden="true">
      <svg viewBox="0 0 680 460" fill="none" focusable="false">
        <g stroke="currentColor" strokeWidth="1">
          <path d="M80 170 210 90 340 200 480 100 600 210 470 340 340 200 210 360 80 170M210 90 210 360M480 100 470 340M80 170 340 200 600 210" />
        </g>
        <g fill="currentColor">
          <circle cx="80" cy="170" r="5" /><circle cx="210" cy="90" r="7" />
          <circle cx="340" cy="200" r="10" /><circle cx="480" cy="100" r="5" />
          <circle cx="600" cy="210" r="6" /><circle cx="470" cy="340" r="7" />
          <circle cx="210" cy="360" r="5" />
        </g>
      </svg>
    </div>
  );
}

export function ResearchWorkflow() {
  return (
    <div className="research-workflow mx-auto mb-5 flex max-w-[240px] items-center justify-center" aria-hidden="true">
      <span className="research-workflow-node"><BookOpen /></span>
      <span className="research-workflow-link" />
      <span className="research-workflow-node"><GitBranch /></span>
      <span className="research-workflow-link" />
      <span className="research-workflow-node"><FileCheck2 /></span>
    </div>
  );
}
