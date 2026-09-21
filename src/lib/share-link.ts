/**
 * Base address for links handed to other people.
 *
 * The editor preview host (id-preview--<project>.lovable.app) is only reachable
 * for signed-in Lovable accounts, so a link copied there sends guests to a login
 * page. In that case we fall back to the stable public project address.
 */
export function shareOrigin(): string {
  if (typeof window === "undefined") return "";
  const { origin, hostname } = window.location;
  const preview = hostname.match(/^id-preview--([0-9a-f-]+)\.lovable\.app$/i);
  if (preview) return `https://project--${preview[1]}.lovable.app`;
  const dev = hostname.match(/^project--([0-9a-f-]+)-dev\.lovable\.app$/i);
  if (dev) return `https://project--${dev[1]}.lovable.app`;
  return origin;
}

/** Full public link for a path like `/share/<token>`. */
export function shareLink(path: string): string {
  return `${shareOrigin()}${path}`;
}
