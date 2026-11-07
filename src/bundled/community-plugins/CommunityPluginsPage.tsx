import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Host } from "../../features/host/service";
import { useIdentityNames } from "../../features/identity-names/react";
import { SafeMarkdown } from "../../features/messages/SafeMarkdown";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import type { PluginInstaller } from "../../plugins/installer";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  StorefrontIcon,
  WarningCircleIcon,
} from "../../shared/design-system/icons/index";
import { Button } from "../../shared/design-system/ui/Button";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { Field } from "../../shared/design-system/ui/Field";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Input } from "../../shared/design-system/ui/Input";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { Panel } from "../../shared/design-system/ui/Panel";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { SearchField } from "../../shared/design-system/ui/SearchField";
import { Select } from "../../shared/design-system/ui/Select";
import { SurfaceButton } from "../../shared/design-system/ui/SurfaceButton";
import { SwitchPreferenceRow } from "../../shared/design-system/ui/SwitchPreferenceRow";
import {
  accessSummary,
  categories,
  httpsUrl,
  type Index,
  installLabel,
  type Listing,
  loadIndex,
  ranked,
  search,
  type Sort,
  sorts,
  tierLabels,
  upvoteLabel,
} from "./catalog";
import {
  type CommunityCountsView,
  useCommunityCounts,
} from "./useCommunityCounts";
import {
  type CheckedSource,
  checkSource,
  describeSource,
  parseSourceInput,
  type SubmitResult,
  submitSource,
} from "./submit";
import type { Recorder } from "./recorder";
import styles from "./CommunityPluginsPage.module.css";

type Phase = "review" | "installed" | "updated" | "cancelled" | "unavailable";
type Requester = Pick<Host, "request">;

const failures: Partial<Record<Phase, string>> = {
  cancelled: "The review closed before anything was installed.",
  unavailable:
    "Buzz couldn't open its install review. Finish any other plugin review, then try again.",
};

const trustLabel = (listing: Listing) =>
  listing.official ? "Official" : "Community · not reviewed";

const noSubscription = () => () => {};

export type CommunityPluginsPageProps = {
  origin: string;
  host: Requester | undefined;
  installer: PluginInstaller | undefined;
  relay?: RelayData | undefined;
  recorder?: Recorder | undefined;
  openPluginSettings(): void;
};

export function CommunityPluginsPage({
  origin,
  host,
  installer,
  relay,
  recorder,
  openPluginSettings,
}: CommunityPluginsPageProps) {
  const [state, setState] = useState<{
    index?: Index | undefined;
    error?: string | undefined;
    loading: boolean;
  }>({ loading: !!origin && !!host });
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [phases, setPhases] = useState<ReadonlyMap<string, Phase>>(new Map());
  const listRegion = useRef<HTMLElement>(null);
  const counts = useCommunityCounts(relay, recorder, version);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh and Retry read the index again.
  useEffect(() => {
    if (!origin || !host) return;
    let current = true;
    setState((old) => ({ ...old, loading: true, error: undefined }));
    loadIndex(host, origin).then(
      (index) => current && setState({ index, loading: false }),
      (error: unknown) =>
        current &&
        setState((old) => ({
          ...old,
          loading: false,
          error:
            error instanceof Error && error.message.startsWith("The community")
              ? error.message
              : "Buzz couldn't reach the community index.",
        })),
    );
    return () => {
      current = false;
    };
  }, [origin, host, version]);

  const install = async (listing: Listing) => {
    if (!installer || phases.get(listing.slug) === "review") return;
    const set = (phase: Phase) =>
      setPhases((old) => new Map(old).set(listing.slug, phase));
    set("review");
    let result: Phase;
    try {
      result = await installer.requestInstall({
        repository: listing.source.repository,
        reference: listing.source.ref,
        commit: listing.source.commit,
        ...(listing.source.path ? { path: listing.source.path } : {}),
      });
    } catch {
      result = "unavailable";
    }
    set(result);
    if (result === "installed" || result === "updated") void recorder?.sync();
  };

  const listing = state.index?.plugins.find((item) => item.slug === selected);
  const back = () => {
    setSelected(undefined);
    requestAnimationFrame(() => listRegion.current?.focus());
  };

  let body: ReactNode;
  if (!origin)
    body = (
      <EmptyState
        icon={<StorefrontIcon size="1.5rem" />}
        title="No community index configured"
        description="This build of Buzz isn't set up with a community plugin index, so there are no community plugins to browse. You can still add plugins from a Git repository in Settings."
        action={
          <Button onClick={openPluginSettings}>Open plugin settings</Button>
        }
      />
    );
  else if (!host)
    body = (
      <EmptyState
        icon={<StorefrontIcon size="1.5rem" />}
        title="Community plugins aren't available here"
        description="This Buzz can't reach the community index."
      />
    );
  else if (adding)
    body = (
      <AddPlugin
        host={host}
        origin={origin}
        canOpen={(slug) =>
          !!state.index?.plugins.some((item) => item.slug === slug)
        }
        onOpen={(slug) => {
          setAdding(false);
          setSelected(slug);
        }}
        onBack={() => {
          setAdding(false);
          requestAnimationFrame(() => listRegion.current?.focus());
        }}
      />
    );
  else if (listing)
    body = (
      <Detail
        listing={listing}
        counts={counts}
        installer={installer}
        phase={phases.get(listing.slug)}
        onInstall={() => void install(listing)}
        onBack={back}
        openPluginSettings={openPluginSettings}
      />
    );
  else
    body = (
      <Browse
        index={state.index}
        loading={state.loading}
        error={state.error}
        counts={counts}
        onRetry={() => setVersion((old) => old + 1)}
        onOpen={setSelected}
        onAdd={() => setAdding(true)}
        regionRef={listRegion}
      />
    );

  return (
    <Panel aria-label="Community plugins">
      <div className={styles.page}>
        <PanelHeader
          title={
            <PanelHeaderLabel
              title="Community plugins"
              icon={<StorefrontIcon size="1rem" />}
            />
          }
          actions={
            origin &&
            host && (
              <IconButton
                hint="familiar"
                size="sm"
                variant="ghost"
                aria-label="Refresh community plugins"
                title="Refresh community plugins"
                icon={<ArrowsClockwiseIcon size="1rem" />}
                onClick={() => setVersion((old) => old + 1)}
              />
            )
          }
        />
        <div className={styles.body}>{body}</div>
      </div>
    </Panel>
  );
}

function Browse({
  index,
  loading,
  error,
  counts,
  onRetry,
  onOpen,
  onAdd,
  regionRef,
}: {
  index: Index | undefined;
  loading: boolean;
  error: string | undefined;
  counts: CommunityCountsView;
  onRetry(): void;
  onOpen(slug: string): void;
  onAdd(): void;
  regionRef: Ref<HTMLElement>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>("installs");
  const [changing, setChanging] = useState(false);
  const ready = counts.state.status === "ready";
  const visible = useMemo(
    () =>
      index
        ? search(
            ranked(index, sort, ready ? counts : undefined),
            query,
            category,
          )
        : [],
    [index, sort, query, category, ready, counts],
  );
  const present = [...categories].filter(([id]) =>
    index?.plugins.some((plugin) => plugin.category === id),
  );
  const filtered = !!query || !!category;
  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchField
            label="Search community plugins"
            placeholder="Search plugins"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <Select
          label="Sort"
          value={sort}
          onValueChange={(value) => setSort(value as Sort)}
          groups={[
            {
              label: "Sort",
              options: sorts.map(({ id, label }) => ({ value: id, label })),
            },
          ]}
        />
        <Select
          label="Category"
          value={category}
          onValueChange={setCategory}
          groups={[
            {
              label: "Category",
              options: [
                { value: "", label: "All categories" },
                ...present.map(([value, label]) => ({ value, label })),
              ],
            },
          ]}
        />
        <Button onClick={onAdd}>Add your plugin</Button>
      </div>
      <LoadingRegion
        pending={loading && !index}
        label="Reading community plugins…"
        feedback={
          error && (
            <div role="alert" className={styles.alert}>
              <p className="text-body-sm">{error}</p>
              <Button size="sm" loading={loading} onClick={onRetry}>
                Retry
              </Button>
            </div>
          )
        }
      >
        <section
          ref={regionRef}
          tabIndex={-1}
          aria-label="Plugin list"
          className={styles.list}
        >
          {visible.map((listing) => (
            <Row
              key={listing.slug}
              listing={listing}
              installs={ready ? counts.installs(listing.id) : undefined}
              upvotes={ready ? counts.upvotes(listing.id) : 0}
              onOpen={() => onOpen(listing.slug)}
            />
          ))}
          {index && !visible.length && (
            <EmptyState
              icon={<StorefrontIcon size="1.5rem" />}
              title={filtered ? "No plugins match" : "Nothing here yet"}
              description={
                filtered
                  ? "Try a different search or category."
                  : "No community plugins are listed yet."
              }
              action={
                filtered && (
                  <Button
                    onClick={() => {
                      setQuery("");
                      setCategory("");
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          )}
        </section>
      </LoadingRegion>
      {counts.state.status === "unavailable" ? (
        <p className="text-caption text-subtle">{counts.state.message}</p>
      ) : (
        <SwitchPreferenceRow
          label="Record my plugins in this community"
          description="Members of this community can see which plugins you installed and liked. Nobody outside it can. Turning this off removes yours."
          checked={counts.recording}
          disabled={changing || !ready}
          onCheckedChange={(on: boolean) => {
            setChanging(true);
            void counts.changeRecording(on).finally(() => setChanging(false));
          }}
        />
      )}
    </>
  );
}

function Row({
  listing,
  installs,
  upvotes,
  onOpen,
}: {
  listing: Listing;
  installs: number | undefined;
  upvotes: number;
  onOpen(): void;
}) {
  return (
    <SurfaceButton
      className={styles.row}
      aria-label={`Open ${listing.name}`}
      onClick={onOpen}
    >
      <span className={styles.rowText}>
        <span className={`${styles.rowName} text-label`}>{listing.name}</span>
        {listing.tagline && (
          <span className={`${styles.rowTagline} text-body-sm text-secondary`}>
            {listing.tagline}
          </span>
        )}
        <span className="text-caption text-subtle">
          {listing.author.github} · {trustLabel(listing)} ·{" "}
          {categories.get(listing.category)}
        </span>
      </span>
      <span className={`${styles.rowMeta} text-caption text-secondary`}>
        {installs !== undefined && <span>{installLabel(installs)}</span>}
        {upvotes > 0 && (
          <span className={styles.votes}>
            <ArrowUpIcon size="0.75rem" aria-hidden="true" />
            <span aria-hidden="true">{upvotes.toLocaleString("en-US")}</span>
            <span className="sr-only">{upvoteLabel(upvotes)}</span>
          </span>
        )}
      </span>
    </SurfaceButton>
  );
}

function useInstalled(installer: PluginInstaller | undefined, id: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      try {
        return (
          installer?.subscribeInstallationStatus(id, () => listener()) ??
          noSubscription()
        );
      } catch {
        return noSubscription();
      }
    },
    [installer, id],
  );
  return useSyncExternalStore(subscribe, () => {
    try {
      return installer?.getInstallationStatus(id) === "installed";
    } catch {
      return false;
    }
  });
}

function Detail({
  listing,
  counts,
  installer,
  phase,
  onInstall,
  onBack,
  openPluginSettings,
}: {
  listing: Listing;
  counts: CommunityCountsView;
  installer: PluginInstaller | undefined;
  phase: Phase | undefined;
  onInstall(): void;
  onBack(): void;
  openPluginSettings(): void;
}) {
  const installed = useInstalled(installer, listing.id);
  const [voting, setVoting] = useState(false);
  const [voteFailed, setVoteFailed] = useState(false);
  const ready = counts.state.status === "ready";
  const voted = counts.voted(listing.id);
  const upvotes = counts.upvotes(listing.id);
  const voteBlocked = !ready
    ? undefined
    : !counts.recording
      ? "Turn on recording on the plugin list to upvote."
      : !installed || !counts.mine(listing.id)
        ? "Install it to upvote it."
        : undefined;
  const toggleVote = () => {
    if (voting || voteBlocked) return;
    setVoting(true);
    setVoteFailed(false);
    void counts.vote(listing.id, !voted).then((ok) => {
      setVoteFailed(!ok);
      setVoting(false);
    });
  };
  const access = accessSummary(listing.host);
  const video = httpsUrl(listing.demo?.video?.url)
    ? listing.demo?.video?.url
    : undefined;
  const links = Object.entries(listing.links ?? {}).filter(([, url]) =>
    httpsUrl(url),
  );
  const failure = phase && failures[phase];
  const done = phase === "installed" || phase === "updated";
  return (
    <article className={styles.detail} aria-label={listing.name}>
      <div>
        <Button variant="plain" size="inline" onClick={onBack}>
          <ArrowLeftIcon size="1rem" aria-hidden="true" />
          All community plugins
        </Button>
      </div>
      <header className={styles.detailHeader}>
        <h2 className="text-heading">{listing.name}</h2>
        {listing.tagline && (
          <p className="text-body text-secondary">{listing.tagline}</p>
        )}
        <p className="text-caption text-subtle">
          {listing.author.github} · {trustLabel(listing)}
          {ready ? ` · ${installLabel(counts.installs(listing.id))}` : ""}
        </p>
      </header>
      <div className={styles.actions}>
        {installer ? (
          <Button
            variant="prominent"
            loading={phase === "review"}
            onClick={onInstall}
          >
            {installed ? "Reinstall" : "Add to Buzz"}
          </Button>
        ) : (
          <Button onClick={openPluginSettings}>Add from Settings</Button>
        )}
        {ready && (
          <>
            <Button
              aria-pressed={voted}
              disabled={!!voteBlocked}
              loading={voting}
              title={voteBlocked}
              onClick={toggleVote}
            >
              <ArrowUpIcon size="1rem" aria-hidden="true" />
              {voted ? "Upvoted" : "Upvote"}
            </Button>
            <span className="text-caption text-secondary">
              {upvotes ? upvoteLabel(upvotes) : "No upvotes here yet"}
            </span>
          </>
        )}
      </div>
      {voteBlocked && <p className="text-caption text-subtle">{voteBlocked}</p>}
      {voteFailed && (
        <p role="alert" className="text-caption text-subtle">
          Buzz couldn't save your upvote. Try again.
        </p>
      )}
      {phase && phase !== "review" && (
        <div
          role={failure ? "alert" : "status"}
          className={styles.notice}
          data-tone={failure ? "warning" : undefined}
        >
          <p className="text-body-sm">
            {failure ??
              (done
                ? `${listing.name} is ${phase === "updated" ? "updated" : "installed"} and turned on.`
                : "")}
          </p>
          {failure ? (
            <Button size="sm" onClick={onInstall}>
              Try again
            </Button>
          ) : (
            <Button size="sm" onClick={openPluginSettings}>
              Manage in Settings
            </Button>
          )}
        </div>
      )}
      {!installer && (
        <p className="text-body-sm text-secondary">
          This Buzz can't open its install review from here. In Settings, add it
          as a Git repository: {listing.source.repository}, branch{" "}
          {listing.source.ref}
          {listing.source.path ? `, folder ${listing.source.path}` : ""}. Check
          that Buzz shows commit {listing.source.commit} before installing.
        </p>
      )}
      {ready && counts.session && (
        <Installers
          session={counts.session}
          pubkeys={counts.installers(listing.id)}
        />
      )}
      <section className={styles.section}>
        <InlineHeader title="Audit" />
        <p className="text-body-sm">
          {tierLabels[listing.audit.tier]}
          {listing.audit.flags.length
            ? ""
            : " · no flags from the automated scan"}
        </p>
        {listing.audit.flags.length > 0 && (
          <ul className={styles.flags}>
            {listing.audit.flags.map((flag) => (
              <li key={flag.code} className="text-body-sm">
                <WarningCircleIcon size="1rem" aria-hidden="true" />
                <span>
                  <code className="text-mono-sm">{flag.code}</code>{" "}
                  {flag.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
        {listing.audit.accessChanged && (
          <p className="text-body-sm">
            What it can access changed since the last indexed version.
          </p>
        )}
        {!listing.audit.cleared && (
          <p className="text-body-sm">
            A maintainer hasn't cleared this version, so it isn't ranked in
            Trending or Hot.
          </p>
        )}
        <p className="text-caption text-subtle">
          {listing.official
            ? "Published by Block."
            : "Indexed automatically from a public repository. Nobody has reviewed it."}
        </p>
      </section>
      <section className={styles.section}>
        <InlineHeader title="Can access" />
        {access.length ? (
          <ul className={styles.access}>
            {access.map((line) => (
              <li key={line} className="text-body-sm">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm">Nothing beyond its own pages.</p>
        )}
      </section>
      {listing.description && (
        <section className={styles.section}>
          <InlineHeader title="About" />
          <div className={styles.markdown}>
            <SafeMarkdown
              content={listing.description}
              openLink={() => false}
            />
          </div>
        </section>
      )}
      {!!listing.setup?.length && (
        <section className={styles.section}>
          <InlineHeader title="After you add it" />
          <ol className={styles.access}>
            {listing.setup.map((step) => (
              <li key={step.title} className="text-body-sm">
                <span className="text-label">{step.title}</span>
                {step.detail && <span> {step.detail}</span>}
                {step.command && (
                  <code className={`${styles.command} text-mono-sm`}>
                    {step.command}
                  </code>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {(video || links.length > 0) && (
        <section className={styles.section}>
          <InlineHeader title="Links" />
          <ul className={styles.access}>
            {video && (
              <li className="text-body-sm">
                <a href={video} target="_blank" rel="noreferrer">
                  Demo video
                </a>
              </li>
            )}
            {links.map(([label, url]) => (
              <li key={label} className="text-body-sm">
                <a href={url} target="_blank" rel="noreferrer">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** Names shown before the rest are summarized. */
const SHOWN_INSTALLERS = 12;

function Installers({
  session,
  pubkeys,
}: {
  session: RelaySession;
  pubkeys: readonly string[];
}) {
  const name = useIdentityNames(session.names);
  const shown = pubkeys.slice(0, SHOWN_INSTALLERS);
  const key = shown.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `shown`.
  useEffect(() => {
    if (shown.length)
      void session.profiles.ensure(shown, "background").catch(() => {});
  }, [session, key]);
  if (!pubkeys.length) return null;
  const rest = pubkeys.length - shown.length;
  return (
    <section className={styles.section}>
      <InlineHeader title="Installed here by" />
      <p className="text-body-sm">
        {shown
          .map((pubkey) => name(pubkey, `${pubkey.slice(0, 8)}…`))
          .join(", ")}
        {rest > 0 ? ` and ${rest.toLocaleString("en-US")} more` : ""}
      </p>
    </section>
  );
}

type AddState =
  | { step: "idle" }
  | { step: "invalid" }
  | { step: "checking" }
  | { step: "rejected"; message: string }
  | { step: "submitting"; source: CheckedSource }
  | { step: "failed"; source: CheckedSource; message: string }
  | {
      step: "done";
      source: CheckedSource;
      result: Extract<SubmitResult, { ok: true }>;
    };

function AddPlugin({
  host,
  origin,
  canOpen,
  onOpen,
  onBack,
}: {
  host: Requester;
  origin: string;
  canOpen(slug: string): boolean;
  onOpen(slug: string): void;
  onBack(): void;
}) {
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("");
  const [state, setState] = useState<AddState>({ step: "idle" });
  const busy = state.step === "checking" || state.step === "submitting";
  const run = async () => {
    const input = parseSourceInput(repository, ref);
    if (!input) return setState({ step: "invalid" });
    setState({ step: "checking" });
    const checked = await checkSource(host, input);
    if (!checked.ok)
      return setState({ step: "rejected", message: checked.message });
    setState({ step: "submitting", source: checked.source });
    const result = await submitSource(host, origin, checked.source);
    setState(
      result.ok
        ? { step: "done", source: checked.source, result }
        : { step: "failed", source: checked.source, message: result.message },
    );
  };
  const found = "source" in state ? state.source : undefined;
  const listedSlug =
    state.step === "done" &&
    state.result.status === "listed" &&
    state.result.slug &&
    canOpen(state.result.slug)
      ? state.result.slug
      : undefined;
  const error =
    state.step === "invalid"
      ? "Enter a GitHub repository as owner/repo, owner/repo/folder or a github.com link."
      : state.step === "rejected" || state.step === "failed"
        ? state.message
        : undefined;
  return (
    <article className={styles.detail} aria-label="Add your plugin">
      <div>
        <Button variant="plain" size="inline" onClick={onBack}>
          <ArrowLeftIcon size="1rem" aria-hidden="true" />
          All community plugins
        </Button>
      </div>
      <header className={styles.detailHeader}>
        <h2 className="text-heading">Add your plugin</h2>
        <p className="text-body text-secondary">
          List a Buzz plugin whose source is in a public GitHub repository.
        </p>
      </header>
      <section className={styles.section}>
        <ul className={styles.access}>
          <li className="text-body-sm">
            Commit the built <code className="text-mono-sm">manifest.json</code>{" "}
            and <code className="text-mono-sm">plugin.js</code> on a branch or
            tag, at the repository root or in a folder.
          </li>
          <li className="text-body-sm">
            Optionally, add a{" "}
            <code className="text-mono-sm">buzz-listing.yaml</code> next to them
            with a tagline, description, category, tags and screenshots.
          </li>
        </ul>
      </section>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void run();
        }}
      >
        <Field label="Repository">
          <Input
            value={repository}
            placeholder="owner/repo or owner/repo/path/to/plugin"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => setRepository(event.target.value)}
          />
        </Field>
        <Field label="Branch or tag" optional>
          <Input
            value={ref}
            placeholder="Default branch"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => setRef(event.target.value)}
          />
        </Field>
        <div role="status" aria-live="polite" className={styles.form}>
          {state.step === "checking" && (
            <p className="text-body-sm text-secondary">
              Checking that the repository is public and has a built plugin…
            </p>
          )}
          {found && (
            <div className={styles.found}>
              <span className="text-label">{found.name}</span>
              <span className="text-caption text-subtle">
                {found.id} · {describeSource(found)} @ {found.ref}
              </span>
              {found.description && (
                <span className="text-body-sm text-secondary">
                  {found.description}
                </span>
              )}
            </div>
          )}
          {state.step === "submitting" && (
            <p className="text-body-sm text-secondary">
              Found it. Sending it to the index…
            </p>
          )}
          {state.step === "done" && (
            <p className="text-body-sm">
              {state.result.status === "listed"
                ? `${state.result.name} is already listed.`
                : `Submitted. ${state.result.name} will appear after the next index update.`}
            </p>
          )}
        </div>
        {error && (
          <div role="alert" className={styles.notice} data-tone="warning">
            <p className="text-body-sm">{error}</p>
          </div>
        )}
        <p className="text-caption text-subtle">
          Listings are unreviewed community content. Buzz still shows what a
          plugin can access, and the exact commit, before anyone installs it.
        </p>
        <div className={styles.actions}>
          {listedSlug ? (
            <Button variant="prominent" onClick={() => onOpen(listedSlug)}>
              View listing
            </Button>
          ) : state.step === "done" ? (
            <Button onClick={onBack}>Done</Button>
          ) : (
            <Button
              type="submit"
              variant="prominent"
              loading={busy}
              disabled={!repository.trim()}
            >
              Check and submit
            </Button>
          )}
        </div>
      </form>
    </article>
  );
}
