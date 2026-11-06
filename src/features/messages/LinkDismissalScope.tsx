import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { useKnownAgentPubkeys } from "../agents/use-known";
import { LinkDismissContext } from "../conversation/LinkLabelContext";
import { useAgentOwnerEvidence } from "../profiles/useAgentOwnerEvidence";
import type { ChannelMessage } from "../relay/contracts";
import { useListedChannel } from "../relay/listed-channel";
import { useRowProfiles } from "../relay/react";
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
  const profiles = useRowProfiles(session.profiles, [row]);
  const agentHinted = useKnownAgentPubkeys(session, profiles).has(row.authorId);
  const ownership = useAgentOwnerEvidence(
    session,
    own || !agentHinted ? undefined : row.authorId,
  );
  const current = useRef(row);
  current.current = row;
  const inFlight = useRef(false);
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
          if (inFlight.current)
            throw new Error("Wait for the previous change to finish.");
          inFlight.current = true;
          try {
            const rewrite = () => {
              const latest = current.current;
              if (!lastEditableMessage(session, [latest], latest.authorId))
                throw new Error("This message can’t be edited right now.");
              const base = messageEditText(
                latest,
                session.profiles.snapshot(),
                session.agentLibrary.snapshot().identities,
              );
              const next = angleLink(base, link);
              if (!next) throw new Error("This link can’t be changed here.");
              validateMessageEdit(latest, base, next);
              return {
                content: next,
                attachmentSourceId: latest.attachmentSourceId ?? latest.id,
              };
            };
            if (own) {
              const { content, attachmentSourceId } = rewrite();
              session.messages.edit(row.id, content, attachmentSourceId);
            } else await session.messages.editOwnedAgent(row.id, rewrite);
          } finally {
            inFlight.current = false;
          }
        }
      : undefined;
  return <LinkDismissContext value={dismiss}>{children}</LinkDismissContext>;
}
