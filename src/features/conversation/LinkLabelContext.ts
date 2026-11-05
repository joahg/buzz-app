import { createContext, type ReactNode } from "react";
import type { LinkWritten } from "./contracts";

/** Optional host-resolved display label; presentation never resolves a destination. */
export const LinkLabelContext = createContext<string | undefined>(undefined);

/** Authored Markdown formatting stays inside the host anchor. */
export const LinkContentContext = createContext<ReactNode>(undefined);

/** Host-resolved visibility for channel links rendered by a shared link renderer. */
export const LinkChannelPrivateContext = createContext(false);

/** Whether the link is live in a message, rather than a composer decoration or
 * preview: a renderer that reads anything for its link does so only then. */
export const LinkInteractiveContext = createContext(true);

/** The message that holds the link; absent outside a message, such as a draft. */
export const LinkMessageIdContext = createContext<string | undefined>(
  undefined,
);

/** Rewrites one link of the surrounding message to angle brackets, or is absent
 * when the viewer may not edit that message. */
export const LinkDismissContext = createContext<
  | ((link: {
      url: string;
      written: LinkWritten;
      occurrence: number;
    }) => Promise<void>)
  | undefined
>(undefined);

/** Sets the host anchor's description, such as a pull request's state, so a
 * renderer's status reaches assistive technology without joining the link's
 * name. Undefined when there is no anchor to describe. */
export const LinkDescriptionContext = createContext<
  ((description: string | undefined) => void) | undefined
>(undefined);

/** Host workspace opener for a message link's thread tab; false when it cannot. */
export const LinkThreadTabContext = createContext<
  | ((channelId: string, messageId: string, rootId: string) => boolean)
  | undefined
>(undefined);

/** A bundled link renderer's hover card, shown in the host's preview card for
 * its link. Not part of the plugin contract: `LinkRenderer` stays presentation
 * only. `open` opens a target as a message link would, such as a `buzz://`
 * link, and closes the card; false when nothing can open it, and the host says
 * so. */
export type LinkPreview = Readonly<{
  label: string;
  render(open: (target: string) => boolean): ReactNode;
}>;

/** Offers the link's hover card; undefined withdraws it. Undefined when the
 * link is not live in a message, so it has no card. */
export const LinkPreviewContext = createContext<
  ((preview: LinkPreview | undefined) => void) | undefined
>(undefined);
