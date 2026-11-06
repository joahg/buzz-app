import {
  AlarmIcon,
  BellIcon,
  BrowserIcon,
  ChatsCircleIcon,
  NoteIcon,
  GearIcon,
  LightningIcon,
  RobotIcon,
  StorefrontIcon,
} from "../../shared/design-system/icons/index";
import type { RegisteredPage } from "../../features/pages/service";

// Shell-owned presentation keeps plugin content independent of navigation chrome.
// Add page identities here; unknown plugins inherit a consistent layout default.
export const shellPresentation = {
  settings: { label: "Settings", icon: GearIcon, tone: "lavender" },
  channels: { label: "Messages", icon: ChatsCircleIcon, tone: "lime" },
} as const;

// Navigation order is host policy, never plugin activation timing. Match full
// contribution keys so an external page's local ID cannot claim a bundled slot.
const bundledOrder = [
  "buzz.channels/channels",
  "buzz.inbox/inbox",
  "buzz.reminders/reminders",
  "buzz.bestie/bestie",
];
const dockOrder = [
  "buzz.bestie/bestie",
  "buzz.inbox/inbox",
  "buzz.channels/channels",
  "buzz.reminders/reminders",
];
export function orderPages(
  pages: readonly RegisteredPage[],
  location: "default" | "dock" = "default",
) {
  const order = location === "dock" ? dockOrder : bundledOrder;
  const rank = (page: RegisteredPage) => {
    const slot = order.indexOf(page.key);
    return slot === -1 ? order.length : slot;
  };
  return [...pages].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      pagePresentation(a).label.localeCompare(
        pagePresentation(b).label,
        "en",
      ) ||
      a.key.localeCompare(b.key, "en"),
  );
}

const bundledIcons = new Map<string, typeof BrowserIcon>([
  ["buzz.inbox/inbox", BellIcon],
  ["buzz.reminders/reminders", AlarmIcon],
  ["buzz.agents/agents", RobotIcon],
  ["buzz.workflows/workflows", LightningIcon],
  ["buzz.relay-notes/notes", NoteIcon],
  ["buzz.community-plugins/community-plugins", StorefrontIcon],
]);
/** Resolve host navigation policy once, independently of icons and registrations. */
export function pagePlacement(page: RegisteredPage) {
  if (!page.primary) return undefined;
  switch (page.key) {
    case "buzz.channels/channels":
    case "buzz.inbox/inbox":
    case "buzz.bestie/bestie":
    case "buzz.reminders/reminders":
    case "buzz.agents/agents":
    case "buzz.workflows/workflows":
      return "topbar";
    default:
      return page.placement ?? "sidebar";
  }
}

type PagePresentation = Readonly<{
  label: string;
  icon: typeof BrowserIcon;
  tone: string;
  image?: string;
}>;
export function pagePresentation(page: RegisteredPage): PagePresentation {
  if (page.key === "buzz.channels/channels") return shellPresentation.channels;
  const tone = page.layout === "workspace" ? "lime" : "sky";
  const bundledIcon = bundledIcons.get(page.key);
  if (bundledIcon) return { label: page.title, icon: bundledIcon, tone };
  return {
    label: page.title,
    icon: BrowserIcon,
    tone,
    ...(page.icon === undefined ? {} : { image: page.icon }),
  };
}
