export type SectionOutline = Readonly<{
  name: string;
  channels: readonly string[];
}>;

export type PlannedSection = Readonly<{
  name: string;
  existingSectionId: string | undefined;
  channelIds: readonly string[];
  unmatched: readonly string[];
  starred: readonly string[];
}>;

const CHANNEL_LINE = /^(\s+|[-*•]\s*|#)/;

export function normalizeChannelName(name: string) {
  return name
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/**
 * Unindented lines name sections; lines that start with `#`, a bullet or
 * indentation list channels in the section above them.
 */
export function parseSectionOutline(text: string): SectionOutline[] {
  const outline: { name: string; channels: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (CHANNEL_LINE.test(line)) {
      const channel = line.replace(/^\s*[-*•]?\s*/, "").trim();
      const current = outline.at(-1);
      if (current && channel.replace(/^#/, "")) current.channels.push(channel);
      continue;
    }
    const name = line.trim().replace(/:$/, "").trim();
    if (name) outline.push({ name, channels: [] });
  }
  return outline;
}

/** Starred channels stay starred: assigning a section would remove the star. */
export function planSectionImport(
  outline: readonly SectionOutline[],
  channels: readonly Readonly<{ id: string; name: string }>[],
  sections: readonly Readonly<{ id: string; name: string }>[],
  starred: ReadonlySet<string> = new Set(),
): PlannedSection[] {
  const channelIds = new Map<string, string>();
  for (const channel of channels) {
    const key = normalizeChannelName(channel.name);
    if (!channelIds.has(key)) channelIds.set(key, channel.id);
  }
  const sectionIds = new Map(
    sections.map((section) => [section.name.trim().toLowerCase(), section.id]),
  );
  const planned = new Map<
    string,
    {
      name: string;
      existingSectionId: string | undefined;
      channelIds: string[];
      unmatched: string[];
      starred: string[];
    }
  >();
  const claimed = new Set<string>();
  for (const entry of outline) {
    const key = entry.name.toLowerCase();
    let section = planned.get(key);
    if (!section) {
      section = {
        name: entry.name,
        existingSectionId: sectionIds.get(key),
        channelIds: [],
        unmatched: [],
        starred: [],
      };
      planned.set(key, section);
    }
    for (const raw of entry.channels) {
      const name = raw.replace(/^#/, "");
      const id = channelIds.get(normalizeChannelName(raw));
      if (!id) section.unmatched.push(name);
      else if (claimed.has(id)) continue;
      else if (starred.has(id)) section.starred.push(name);
      else section.channelIds.push(id);
      if (id) claimed.add(id);
    }
  }
  return [...planned.values()];
}
