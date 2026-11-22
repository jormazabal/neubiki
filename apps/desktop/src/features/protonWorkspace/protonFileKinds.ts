export function isProtonMarkdown(name: string) {
  return /\.(md|markdown|mdown)$/i.test(name);
}

export function isProtonImage(name: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function isProtonHandwritten(name: string) {
  return /\.(nbnote|knote)$/i.test(name);
}
