export function buildExportDefaultPath(directory: string | null | undefined, fileName: string) {
  const cleanName = fileName.replace(/[<>:"/\\|?*]+/g, "-");
  const cleanDir = directory?.trim();

  if (!cleanDir) {
    return cleanName;
  }

  const separator = cleanDir.includes("\\") ? "\\" : "/";
  return `${cleanDir.replace(/[\\/]+$/, "")}${separator}${cleanName}`;
}
