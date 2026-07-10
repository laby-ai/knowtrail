import path from 'node:path';

export function classroomStorageCandidates(root: string, referenceName: string): string[] {
  const standalone = path.join(root, '.references', referenceName, '.next', 'standalone');
  return [
    path.join(standalone, 'data', 'classrooms'),
    path.join(standalone, '.references', referenceName, 'data', 'classrooms'),
  ];
}
