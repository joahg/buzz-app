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
import { SafeMarkdown } from "../../features/messages/SafeMarkdown";
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
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { IconButton } from "../../shared/design-system/ui/IconButton";
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
  installLine,
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
  canVote,
  hasReported,
  hasUpvoted,
  reportInstall,
  sendVote,
  setShareEnabled,
  shareEnabled,
} from "./telemetry";
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
  openPluginSettings(): void;
};

export function CommunityPluginsPage({
  origin,
  host,
  installer,
  openPluginSettings,
}: CommunityPluginsPageProps) {
  const [state, setState] = useState<{
    index?: Index | undefined;
    error?: string | undefined;
    loading: boolean;
  }>({ loading: !!origin && !!host });
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [phases, setPhases] = useState<ReadonlyMap<string, Phase>>(new Map());
  const [, setReports] = useState(0);
  const listRegion = useRef<HTMLElement>(null);

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
    if (result === "installed" && host)
      void reportInstall(host, origin, listing).then(() =>
        setReports((count) => count + 1),
      );
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
  else if (listing)
    body = (
      <Detail
        listing={listing}
        host={host}
        origin={origin}
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
        onRetry={() => setVersion((old) => old + 1)}
        onOpen={setSelected}
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
  onRetry,
  onOpen,
  regionRef,
}: {
  index: Index | undefined;
  loading: boolean;
  error: string | undefined;
  onRetry(): void;
  onOpen(slug: string): void;
  regionRef: Ref<HTMLElement>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>("allTime");
  const [share, setShare] = useState(shareEnabled);
  const visible = useMemo(
    () => (index ? search(ranked(index, sort), query, category) : []),
    [index, sort, query, category],
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
              sort={sort}
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
                  : sort === "mostUpvoted"
                    ? "Nothing has upvotes yet. People who add a plugin from here can upvote it."
                    : sort === "allTime"
                      ? "No community plugins are listed yet."
                      : "Trending and Hot include only cleared plugins with a few installs."
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
      <SwitchPreferenceRow
        label="Share anonymous install counts and upvotes"
        description="Counts a plugin you add from here, and lets you upvote it, using a random identifier that stays on this device. Only public repositories are counted."
        checked={share}
        onCheckedChange={(on: boolean) => {
          setShareEnabled(on);
          setShare(on);
        }}
      />
    </>
  );
}

function Row({
  listing,
  sort,
  onOpen,
}: {
  listing: Listing;
  sort: Sort;
  onOpen(): void;
}) {
  const upvotes = listing.upvotes ?? 0;
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
        <span>{installLine(listing, sort)}</span>
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
  host,
  origin,
  installer,
  phase,
  onInstall,
  onBack,
  openPluginSettings,
}: {
  listing: Listing;
  host: Requester;
  origin: string;
  installer: PluginInstaller | undefined;
  phase: Phase | undefined;
  onInstall(): void;
  onBack(): void;
  openPluginSettings(): void;
}) {
  const installed = useInstalled(installer, listing.id);
  const [voted, setVoted] = useState(() => hasUpvoted(listing.key));
  const [baseline] = useState(voted);
  const [voting, setVoting] = useState(false);
  const upvotes = Math.max(
    0,
    (listing.upvotes ?? 0) + Number(voted) - Number(baseline),
  );
  const voteBlocked =
    !installed || !hasReported(listing.key)
      ? "Add it to Buzz from here to upvote it."
      : !shareEnabled()
        ? "Turn on anonymous sharing on the plugin list to upvote."
        : undefined;
  const toggleVote = () => {
    if (voting || !canVote(listing)) return;
    const next = !voted;
    setVoted(next);
    setVoting(true);
    void sendVote(host, origin, listing, next).then((ok) => {
      if (!ok) setVoted(!next);
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
          {listing.author.github} · {trustLabel(listing)} ·{" "}
          {installLine(listing, "allTime")}
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
          {upvotes ? upvoteLabel(upvotes) : "No upvotes yet"}
        </span>
      </div>
      {voteBlocked && <p className="text-caption text-subtle">{voteBlocked}</p>}
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
