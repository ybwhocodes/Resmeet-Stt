export const MEDIA_EXTENSIONS = [
  ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".webm", ".mp4", ".mpeg", ".mpg", ".mpe", ".mpga", ".m4v", ".aac",
];

// Explicit extensions also work when a file picker has no MIME association for MPEG.
export const MEDIA_ACCEPT = ["audio/*", "video/*", ...MEDIA_EXTENSIONS].join(",");
export const MEDIA_FORMAT_LABEL = MEDIA_EXTENSIONS.map((extension) => extension.slice(1).toUpperCase()).join(", ");

export function isSupportedMediaFile(file) {
  const extension = file?.name?.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  return MEDIA_EXTENSIONS.includes(extension);
}
