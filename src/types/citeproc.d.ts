declare module "citeproc" {
  interface Item {
    id: string;
    type: string;
    title: string;
    author?: Array<{ family?: string; given?: string; literal?: string }>;
    issued?: { "date-parts": number[][] };
    [key: string]: unknown;
  }
  export class Engine {
    constructor(
      sys: {
        retrieveLocale: (language: string) => string;
        retrieveItem: (id: string) => Item;
      },
      style: string,
      language?: string,
    );
    updateItems(ids: string[]): void;
    setOutputFormat(format: "text" | "html"): void;
    makeCitationCluster(items: Array<{ id: string }>): string;
    makeBibliography(): [
      {
        entry_ids: string[][];
        hangingindent?: boolean;
        "second-field-align"?: string;
      },
      string[],
    ] | false;
  }
  const CSL: { Engine: typeof Engine };
  export default CSL;
}
