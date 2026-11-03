import { useId, useMemo, useRef, useState, type ComponentProps } from "react";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { SidebarGroups } from "../../features/relay/sidebar-preferences";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Field } from "../../shared/design-system/ui/Field";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { parseSectionOutline, planSectionImport } from "./section-import";

const PLACEHOLDER = `Team
#agent-ops
#agent-autonomy

Projects
#buzz-dev`;

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Mounted after the launching menu closes, so focus has one modal owner. */
export function ImportSidebarSections({
  channels,
  sections,
  starred,
  writable,
  createSection,
  assign,
  close,
  finalFocus = false,
}: {
  channels: readonly ChannelSummary[];
  sections: SidebarGroups["sections"];
  starred: ReadonlySet<string>;
  writable: boolean;
  createSection: (section: { id: string; name: string }) => Promise<unknown>;
  assign: (channelId: string, sectionId: string) => Promise<unknown>;
  close: () => void;
  finalFocus?: ComponentProps<typeof Dialog>["finalFocus"];
}) {
  const formId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // A failed confirmation may follow a successful write, so a retry reuses the
  // same section identity rather than creating a duplicate.
  const created = useRef(new Map<string, string>());
  const plan = useMemo(
    () =>
      planSectionImport(parseSectionOutline(text), channels, sections, starred),
    [text, channels, sections, starred],
  );
  const matched = plan.reduce((n, section) => n + section.channelIds.length, 0);
  const submit = async () => {
    if (pending || !writable || !plan.length) return;
    setPending(true);
    setError("");
    const saved = new Set(sections.map((section) => section.id));
    try {
      for (const section of plan) {
        const key = section.name.toLowerCase();
        let id = section.existingSectionId ?? created.current.get(key);
        if (!id) {
          id = crypto.randomUUID();
          created.current.set(key, id);
        }
        if (!saved.has(id)) await createSection({ id, name: section.name });
        for (const channelId of section.channelIds) await assign(channelId, id);
      }
      close();
    } catch {
      setError("Some sections or channels weren't saved. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      preventClose={pending}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Import sections"
      description="Paste a list of sections, such as your Slack sidebar. Put each section name on its own line, followed by its channels."
      initialFocus={input}
      finalFocus={finalFocus}
      actions={
        <>
          <Button disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            form={formId}
            type="submit"
            variant="prominent"
            disabled={!writable || !plan.length}
            loading={pending}
          >
            {`Import ${count(matched, "channel")}`}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Sections"
          description="Start channel lines with #, a bullet or an indent. Sections with the same name are reused."
          error={
            error ||
            (!writable
              ? "Saved preferences are unavailable. Refresh and try again."
              : undefined)
          }
        >
          <Textarea
            ref={input}
            variant="code"
            surface="panel"
            rows={8}
            placeholder={PLACEHOLDER}
            readOnly={pending}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {plan.length > 0 && (
          <ul aria-label="Import preview" className="flex flex-col gap-2">
            {plan.map((section) => (
              <li key={section.name} className="flex flex-col">
                <span className="text-body-sm">
                  {section.name}
                  <span className="text-subtle">
                    {` · ${section.existingSectionId ? "existing" : "new"} · ${count(section.channelIds.length, "channel")}`}
                  </span>
                </span>
                {section.unmatched.length > 0 && (
                  <span className="text-caption text-subtle">
                    {`Not in your channels: ${section.unmatched.join(", ")}`}
                  </span>
                )}
                {section.starred.length > 0 && (
                  <span className="text-caption text-subtle">
                    {`Staying in Starred: ${section.starred.join(", ")}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </form>
    </Dialog>
  );
}
