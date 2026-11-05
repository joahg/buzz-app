import { useSyncExternalStore, type ReactNode } from "react";
import { LinkDismissContext } from "../conversation/LinkLabelContext";
import { useAgentOwnerEvidence } from "../profiles/useAgentOwnerEvidence";
import type { ChannelMessage } from "../relay/contracts";
import { useListedChannel } from "../relay/listed-channel";
import type { RelaySession } from "../relay/session";
import { fullSession, type ComposerSession } from "./composer-session";
import { angleLink } from "./link-forms";
import { messageEditText, validateMessageEdit } from "./message-edit";
import { lastEditableMessage } from "./useMessageEdit";

const hasLink = (content: string) => /\w:\/\/|www\./i.test(content);
const noEvents: readonly never[] = [];
const noSnapshot = () => noEvents;
const noSubscribe = () => () => {};

/** Lets a link renderer in this message rewrite one of its links to angle
 * brackets, as an ordinary edit, when the viewer may edit the message: its
 * author, or the verified owner of the agent that wrote it. */
export function LinkDismissalScope({
  row,
  session,
  interactive,
  children,
}: {
  row: ChannelMessage;
  session: RelaySession | ComposerSession | undefined;
  interactive: boolean;
  children: ReactNode;
}) {
  const full = interactive ? fullSession(session) : undefined;
  if (!full?.viewer || !hasLink(row.content)) return children;
  return (
    <Dismissable row={row} session={full}>
      {children}
    </Dismissable>
  );
}

function Dismissable({
  row,
  session,
  children,
}: {
  row: ChannelMessage;
  session: RelaySession;
  children: ReactNode;
}) {
  const own = row.authorId === session.viewer;
  const writable = useListedChannel(
    session.channels,
    row.channelId,
    (channel) =>
      !!channel && !channel.readOnly && !channel.cached && !channel.archived,
  );
  const ownership = useAgentOwnerEvidence(
    session,
    own ? undefined : row.authorId,
  );
  useSyncExternalStore(
    session.outbox?.subscribe ?? noSubscribe,
    session.outbox?.snapshot ?? noSnapshot,
    session.outbox?.snapshot ?? noSnapshot,
  );
  const owner =
    !own &&
    !!session.viewer &&
    ownership.status === "ready" &&
    ownership.owner === session.viewer;
  const dismiss =
    writable &&
    (own || owner) &&
    lastEditableMessage(session, [row], row.authorId)
      ? async (link: Parameters<typeof angleLink>[1]) => {
          const base = messageEditText(
            row,
            session.profiles.snapshot(),
            session.agentLibrary.snapshot().identities,
          );
          const next = angleLink(base, link);
          if (!next) throw new Error("This link can’t be changed here.");
          validateMessageEdit(row, base, next);
          const source = row.attachmentSourceId ?? row.id;
          if (own) session.messages.edit(row.id, next, source);
          else await session.messages.editOwnedAgent(row.id, next, source);
        }
      : undefined;
  return <LinkDismissContext value={dismiss}>{children}</LinkDismissContext>;
}
