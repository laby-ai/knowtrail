export function extractHtmlDocument(raw: string): string | null {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const docMatch = candidate.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) || candidate.match(/<html[\s\S]*<\/html>/i);
  if (!docMatch) return null;
  const html = docMatch[0];
  // Reject anything that could execute script or reach the network.
  if (/<script\b/i.test(html)) return null;
  if (/\bon[a-z]+\s*=/i.test(html)) return null;
  if (/@import|<link\b|<iframe\b|<object\b|<embed\b|<base\b|<form\b|http-equiv\s*=/i.test(html)) return null;
  for (const resource of html.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!/^(?:#|data:image\/(?:png|jpeg|webp);base64,)/i.test(resource[2])) return null;
  }
  for (const attribute of html.matchAll(/\b(?:src|srcset|href|xlink:href|action)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi)) {
    if (!/^(?:#|data:image\/(?:png|jpeg|webp);base64,)/i.test(attribute[2] ?? attribute[3])) return null;
  }
  return html;
}
