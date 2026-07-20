interface ClipboardPorts {
  writeText?: (text: string) => Promise<void>;
  legacyCopy?: (text: string) => boolean;
}

export async function copyTextWithFallback(text: string, ports: ClipboardPorts = {}): Promise<boolean> {
  if (!text.trim()) return false;
  const writeText = ports.writeText || defaultWriteText;
  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      // HTTP deployments and browser privacy modes can reject the modern Clipboard API.
    }
  }
  const legacyCopy = ports.legacyCopy || defaultLegacyCopy;
  try {
    return legacyCopy(text);
  } catch {
    return false;
  }
}

const defaultWriteText = typeof navigator !== 'undefined' && navigator.clipboard?.writeText
  ? navigator.clipboard.writeText.bind(navigator.clipboard)
  : undefined;

function defaultLegacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}
