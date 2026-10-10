export function encodeCrdtBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192)
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return btoa(parts.join(""));
}
export function decodeCrdtBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
