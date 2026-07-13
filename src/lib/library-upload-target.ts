export function resolveLibraryUploadTarget(
  selectedFolderId: string | null,
  folders: Array<{ id: string }>,
): string | null {
  if (!selectedFolderId) return null;
  return folders.some(folder => folder.id === selectedFolderId) ? selectedFolderId : null;
}
