import type { CslRun } from "@/lib/csl-contract";
export function CslFormattedText({ runs }: { runs: CslRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        const text = (
          <span
            style={{
              fontStyle: run.italic ? "italic" : undefined,
              fontWeight: run.bold ? "bold" : undefined,
              fontVariant: run.smallCaps ? "small-caps" : undefined,
            }}
          >
            {run.text}
          </span>
        );
        return run.superscript ? (
          <sup key={index}>{text}</sup>
        ) : (
          <span key={index}>{text}</span>
        );
      })}
    </>
  );
}
