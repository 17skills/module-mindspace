/** Social networks whose profiles need a login — never scrape them for context. */
export const PROFILE_HOSTS: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "xing.com": "Xing",
  "x.com": "X",
  "twitter.com": "X",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "threads.net": "Threads",
  "tiktok.com": "TikTok",
  "mastodon.social": "Mastodon",
};

export function profileProvider(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const [domain, label] of Object.entries(PROFILE_HOSTS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return label;
  }
  return null;
}

/**
 * True for profile-link modules — they deliberately carry no extracted page
 * text and are never sent to the chat as context.
 */
export function isProfileLink(record: {
  type: string;
  source_url: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (record.type !== "link") return false;
  if (typeof record.metadata?.["provider"] === "string") return true;
  if (!record.source_url) return false;
  try {
    return Boolean(profileProvider(new URL(record.source_url).hostname));
  } catch {
    return false;
  }
}
