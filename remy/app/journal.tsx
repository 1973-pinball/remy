"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Brand } from "@/components/brand";
import {
  Sun,
  Utensils,
  Footprints,
  MessageCircle,
  Plus,
  Settings,
  Plug,
  Sparkles,
  CalendarDays,
  Upload,
  Check,
  Pencil,
  Bookmark,
  Download,
  ShieldCheck,
  Send,
  Flame,
  Leaf,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  MealDialog,
  DayDialog,
  TrainingDialog,
  ImportDialog,
  etlFields,
  type SaveRecord,
} from "./forms";
import { TrainingView, ConnectionsView, SettingsView } from "./secondary-views";
import {
  summarize,
  ofKind,
  weeklyTraining,
  localDate,
  addDays,
  round,
  fuelingPlan,
  type Entry,
  type Meal,
  type Workout,
  type Plan,
  type Day,
} from "@/lib/domain";
import { sampleEntries } from "@/lib/fixtures";
import { insights, type InsightItem } from "@/lib/insights";
type View =
  | "Today"
  | "Food"
  | "Training"
  | "Insights"
  | "Chat"
  | "Connections"
  | "Settings";
const nav = [
  ["Today", Sun],
  ["Food", Utensils],
  ["Training", Footprints],
  ["Insights", Sparkles],
  ["Chat", MessageCircle],
] as const;
const value = (n: number | null | undefined, unit = "") =>
  n == null ? "—" : `${Math.round(n).toLocaleString()}${unit}`;
const number = (n: number | null | undefined, unit = "") =>
  n == null ? "—" : `${round(n).toLocaleString()}${unit}`;

export function ownedDeviceDrafts(drafts: any[], ownerId: string | null) {
  return ownerId ? drafts.filter((draft) => draft?.ownerId === ownerId) : [];
}

export function claimUnassignedDeviceDrafts(drafts: any[], ownerId: string | null) {
  if (!ownerId) throw new Error("Sign in before claiming drafts created on this device.");
  return drafts.map((draft) => draft && draft.ownerId == null ? { ...draft, ownerId } : draft);
}
function Metric({
  label,
  amount,
  note,
  icon: Icon,
}: {
  label: string;
  amount: string;
  note: string;
  icon: typeof Sun;
}) {
  return (
    <article className="stat-card">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{amount}</strong>
      <p>{note}</p>
    </article>
  );
}
function SourceLine({ entries }: { entries: Entry<any>[] }) {
  return (
    <div className="source-line">
      <ShieldCheck size={13} />
      <span>
        {entries.length
          ? `${entries.length} source records · refreshed ${new Date(entries.reduce((a, e) => (e.updatedAt > a ? e.updatedAt : a), "")).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "No source records yet"}
      </span>
    </div>
  );
}
export default function Journal() {
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "236px" } as React.CSSProperties}
    >
      <JournalContent />
    </SidebarProvider>
  );
}
function JournalContent() {
  const { setOpenMobile } = useSidebar();
  const pendingChat = useRef<{message:string;date:string;id:string}|null>(null);
  const refreshVersion = useRef(0);
  const [view, setView] = useState<View>("Today"),
    [date, setDate] = useState(localDate()),
    [entries, setEntries] = useState<Entry[]>([]),
    [demo, setDemo] = useState(false),
    [demoEntries, setDemoEntries] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [connectionError, setConnectionError] = useState(""),
    [user, setUser] = useState<{
      id: string;
      name: string;
      email: string;
    } | null>(null),
    [modal, setModal] = useState<
      "meal" | "day" | "import" | "run" | "plan" | "drafts" | null
    >(null),
    [editing, setEditing] = useState<Entry<any> | null>(null),
    [drafts, setDrafts] = useState<any[]>([]),
    [chat, setChat] = useState(""),
    [chatBusy, setChatBusy] = useState(false),
    [period, setPeriod] = useState(14);
  const ownedDrafts = ownedDeviceDrafts(drafts, user?.id ?? null);
  const hasUnassignedDrafts = !!user && drafts.some((draft) => draft && draft.ownerId == null);
  const records = demo ? demoEntries : entries,
    summary = useMemo(() => summarize(records, date), [records, date]),
    week = useMemo(() => weeklyTraining(records, date), [records, date]),
    brief = useMemo(() => insights(records, date), [records, date]),
    profile = summary.profile,
    workouts = ofKind<Workout>(records, "workout"),
    plans = ofKind<Plan>(records, "plan").filter((p) => !p.data.cancelled),
    savedMeals = ofKind<Meal>(records, "savedMeal");
  const clearPrivateView = useCallback(() => {
    refreshVersion.current++;
    setEntries([]);
    setUser(null);
    setEditing(null);
    setModal(null);
    setChat("");
    setChatBusy(false);
    pendingChat.current = null;
    setLoading(false);
  }, []);
  const requireActiveSession = useCallback((response: Response) => {
    if (response.status === 401 || response.status === 403) {
      clearPrivateView();
      setConnectionError("Sign in again to open your private journal.");
      throw new Error("Sign in again to open your private journal.");
    }
  }, [clearPrivateView]);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    try {
      const r = await fetch("/api/journal?date=" + date, { cache: "no-store" });
      if (version !== refreshVersion.current) return;
      requireActiveSession(r);
      const data = await r.json();
      if (version !== refreshVersion.current) return;
      if (!r.ok) throw new Error(data.error ?? "Could not open journal");
      setEntries(data.entries);
      setUser(data.user);
      setConnectionError("");
    } catch (e) {
      if (version === refreshVersion.current) setConnectionError((e as Error).message);
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, [date, requireActiveSession]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("view");
    if (
      v &&
      [
        "Today",
        "Food",
        "Training",
        "Insights",
        "Chat",
        "Connections",
        "Settings",
      ].includes(v)
    )
      setView(v as View);
    const day = url.searchParams.get("date");
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) setDate(day);
    setDemoEntries(sampleEntries(localDate()));
    try {
      const stored = JSON.parse(localStorage.getItem("remy-offline-drafts") ?? "[]");
      if (Array.isArray(stored)) setDrafts(stored.filter((draft) => draft && typeof draft === "object" && typeof draft.id === "string"));
    } catch {}
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (!demo) void refresh();
  }, [refresh, demo]);
  useEffect(() => {
    if (demo) return;
    let lastCheck = 0;
    const revalidate = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastCheck < 1000) return;
      lastCheck = Date.now();
      void refresh();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) { clearPrivateView(); lastCheck = 0; revalidate(); }
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("pageshow", restored);
    };
  }, [demo, refresh, clearPrivateView]);
  useEffect(() => {
    const target =
      new URL(window.location.href).searchParams.get("record") ||
      decodeURIComponent(window.location.hash.slice(1));
    if (target)
      document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [view, date, records]);
  const go = (v: View) => {
    setView(v);
    setOpenMobile(false);
    const u = new URL(window.location.href);
    u.searchParams.set("view", v);
    u.searchParams.set("date", date);
    window.history.replaceState(null, "", u.pathname + u.search);
  };
  const recordDraft = (r: SaveRecord) => {
    const draft = {
      ...r,
      id: r.id ?? crypto.randomUUID(),
      ownerId: user?.id ?? null,
      queuedAt: new Date().toISOString(),
    };
    const next = [...drafts.filter((d) => d.id !== draft.id), draft];
    localStorage.setItem("remy-offline-drafts", JSON.stringify(next));
    setDrafts(next);
    toast("Saved on this device. Review and send when online.");
  };
  async function save(r: SaveRecord, queueOffline = true) {
    if (demo) {
      const id = r.id ?? `sample-${crypto.randomUUID()}`;
      setDemoEntries((old) => {
        const existing = old.find((e) => e.id === id),
          record: Entry = {
            id,
            kind: r.kind as Entry["kind"],
            localDate: r.localDate,
            source: "fixture",
            sourceId: id,
            revision: (existing?.revision ?? 0) + 1,
            updatedAt: new Date().toISOString(),
            data: r.data as Record<string, unknown>,
            deleted: r.deleted,
          };
        return [...old.filter((e) => e.id !== id), record];
      });
      toast("Sample updated. Your real journal is unchanged.");
      return;
    }
    if (!navigator.onLine && r.kind === "meal") {
      if (!queueOffline) throw new Error("You are offline. This draft stays on your device until it is saved successfully.");
      recordDraft(r);
      return;
    }
    const pending = { ...r, id: r.id ?? crypto.randomUUID() };
    let response: Response;
    try {
      response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
    } catch (e) {
      if (r.kind === "meal" && queueOffline) {
        recordDraft(pending);
        return;
      }
      throw e;
    }
    requireActiveSession(response);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    await refresh();
    toast("Saved to your journal", {
      action: { label: "Undo", onClick: () => void undo(result.entry) },
    });
  }
  async function undo(entry: Entry) {
    try {
      const r = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          id: entry.id,
          revision: entry.revision,
        }),
      });
      requireActiveSession(r);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await refresh();
      toast("Change undone");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const saveDay = (day: Day) => {
    const old = ofKind<Day>(records, "day").find((d) => d.localDate === date);
    return save({
      id: old?.id ?? `day:${date}`,
      kind: "day",
      localDate: date,
      revision: old?.revision,
      data: day,
    });
  };
  async function sendChat(e?: React.FormEvent) {
    e?.preventDefault();
    if (!chat.trim()) return;
    if (demo) {
      toast(
        "Journal chat uses saved records. Exit sample mode and connect your database.",
      );
      return;
    }
    setChatBusy(true);
    if (pendingChat.current?.message !== chat || pendingChat.current?.date !== date)
      pendingChat.current = {message:chat,date,id:crypto.randomUUID()};
    try {
      const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: chat,
            date,
            id: pendingChat.current.id,
          }),
        });
      requireActiveSession(r);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      pendingChat.current = null;
      setChat("");
      await refresh();
      if (d.action?.entry)
        toast("Journal updated", {
          action: { label: "Undo", onClick: () => void undo(d.action.entry) },
        });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChatBusy(false);
    }
  }
  const meals = summary.meals,
    cycle = [...summary.expenditure].sort((a, b) =>
      b.start.localeCompare(a.start),
    )[0],
    next =
      summary.plans[0] ??
      plans
        .filter((p) => p.localDate! > date && !p.data.completedWorkoutId)
        .sort((a, b) => a.localDate!.localeCompare(b.localDate!))[0];
  function mealList(list: Entry<Meal>[]) {
    return list.length ? (
      <div className="meal-list">
        {list.map((m) => (
          <article className="meal-row" key={m.id} id={m.id}>
            <span className="meal-icon">
              <Utensils size={18} />
            </span>
            <div className="meal-info">
              <div>
                <span className="eyebrow">{m.data.mealType}</span>
                <span className="mini-tag">{m.data.confidence}</span>
                {m.source === "remy-etl" && (
                  <span className="mini-tag">REMY ETL</span>
                )}
              </div>
              <h3>{m.data.title}</h3>
              <p>
                P {number(m.data.protein, " g")} · C{" "}
                {number(m.data.carbs, " g")} · F {number(m.data.fat, " g")} ·
                Fiber {number(m.data.fiber, " g")}
              </p>
              {m.data.workoutId && (
                <small>Run fuel · included once in daily intake</small>
              )}
            </div>
            <div className="meal-end">
              <strong>
                {value(m.data.calories)}
                <small> kcal</small>
              </strong>
              <div>
                <button
                  aria-label={`Correct ${m.data.title}`}
                  onClick={() => {
                    setEditing(m);
                    setModal("meal");
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label={`Save ${m.data.title} for reuse`}
                  onClick={() =>
                    void save({
                      kind: "savedMeal",
                      localDate: null,
                      data: m.data,
                    }).catch((e) => toast.error(e.message))
                  }
                >
                  <Bookmark size={15} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <div className="empty-block">
        <span className="empty-icon">
          <Utensils />
        </span>
        <h3>Your first meal goes here.</h3>
        <p>
          Unlogged food stays unknown. Bring in your REMY history or start with
          a meal.
        </p>
        <button
          className="text-button"
          onClick={() => {
            setEditing(null);
            setModal("meal");
          }}
        >
          Log a meal <Plus size={16} />
        </button>
      </div>
    );
  }
  function etlPanel() {
    return (
      <section className="card etl-card">
        <div className="section-heading">
          <h2>
            <Leaf size={18} /> Eat to Live, today
          </h2>
          <span>From individual meals</span>
        </div>
        <div className="etl-grid">
          {etlFields.slice(0, 10).map(([key, label, unit]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>
                {number(summary.etl[key]?.value)}
                <small>{unit}</small>
              </strong>
              {summary.etl[key] &&
                !summary.etl[key].complete &&
                summary.etl[key].known > 0 && (
                  <small className="coverage-note">
                    Known for {summary.etl[key].known}/{meals.length} meals
                  </small>
                )}
            </div>
          ))}
        </div>
        <p className="microcopy">
          A dash means unknown. Partial sums show their coverage. These
          contributions describe your food; they are not automatic quotas.
        </p>
        <details>
          <summary>Flex and run fuel</summary>
          <p className="muted">
            These are portions of logged intake, never extra calories.
          </p>
          {etlFields.slice(10).map(([key, label]) => (
            <p key={key}>
              {label}:{" "}
              {summary.etl[key]?.value == null
                ? "Not specified"
                : value(summary.etl[key].value, " kcal")}
            </p>
          ))}
        </details>
      </section>
    );
  }
  function citations(item: InsightItem) {
    return (
      <div className="evidence-links">
        {item.recordLinks.slice(0, 6).map((l) => (
          <a
            key={l.id}
            href={l.href}
            onClick={(e) => {
              e.preventDefault();
              const u = new URL(l.href, window.location.origin);
              go(u.searchParams.get("view") as View);
              if (l.date) setDate(l.date);
              window.history.replaceState(
                null,
                "",
                u.pathname + u.search + "#" + encodeURIComponent(l.id),
              );
              requestAnimationFrame(() =>
                document
                  .getElementById(l.id)
                  ?.scrollIntoView({ block: "center" }),
              );
            }}
          >
            {l.kind} · {l.date ?? "profile"} · v{l.revision}
          </a>
        ))}
      </div>
    );
  }
  const dateTitle = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <>
      <Sidebar className="remy-sidebar">
        <SidebarHeader>
          <Brand />
          <p className="sidebar-label">YOUR DAILY COMPANION</p>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {nav.map(([label, Icon]) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  isActive={view === label}
                  onClick={() => go(label)}
                >
                  <Icon />
                  <span>{label === "Food" ? "Food & ETL" : label}</span>
                  {view === label && <span className="nav-dot" />}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="race-note">
            <Footprints size={22} />
            <p>
              {profile.raceDate
                ? `${Math.max(0, Math.ceil((Date.parse(profile.raceDate) - Date.parse(date)) / 86400000))} days to race day`
                : "One day at a time."}
            </p>
            <span>{profile.raceDate ?? "Your marathon starts here."}</span>
          </div>
          <SidebarMenu>
            {(
              [
                ["Connections", Plug],
                ["Settings", Settings],
              ] as const
            ).map(([label, Icon]) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  isActive={view === label}
                  onClick={() => go(label)}
                >
                  <Icon />
                  {label === "Settings" ? "Your profile" : label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <a className="privacy-link" href="/privacy">Privacy policy</a>
          <div className="account">
            <span>{(profile.name || "R")[0]}</span>
            <div>
              {demo ? "Sample runner" : profile.name || "Your private journal"}
              <small>
                {demo
                  ? "Synthetic data only"
                  : user
                    ? "Private · signed in"
                    : "Sign in to save"}
              </small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>YOUR TRAINING, WELL FUELED</span>
          </div>
          <div className="topbar-actions">
            {user && !demo && (ownedDrafts.length > 0 || hasUnassignedDrafts) && (
              <button
                className="quiet-button"
                onClick={() => setModal("drafts")}
              >
                {ownedDrafts.length ? `${ownedDrafts.length} drafts` : "Review device drafts"}
              </button>
            )}
            <button className="quiet-button" onClick={() => setDemo(!demo)}>
              {demo ? "Exit sample" : "Explore sample"}
            </button>
            {user ? (
              <form action="/auth/signout" method="POST">
                <button className="quiet-button">Sign out</button>
              </form>
            ) : (
              <a href="/login" className="quiet-button">
                Sign in
              </a>
            )}
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{dateTitle.toUpperCase()}</p>
              <h1>
                {view === "Today"
                  ? "Fuel the work you’re putting in."
                  : view === "Food"
                    ? "Your food. The full picture."
                    : view === "Training"
                      ? "The running context."
                      : view === "Insights"
                        ? "Make the connection."
                        : view === "Chat"
                          ? "Talk it through."
                          : view === "Connections"
                            ? "Bring it all together."
                            : "Make Remy Mux yours."}
              </h1>
              <p>
                {view === "Today"
                  ? "Your Eat to Live journal, with your running in mind."
                  : view === "Food"
                    ? "Meals, corrections, and the history behind your nutrition."
                    : view === "Training"
                      ? "Just the headlines that help you fuel your training."
                      : view === "Insights"
                        ? "Practical nutrition ideas, grounded in your records."
                        : view === "Connections"
                          ? "Each source connects independently. Your journal keeps working."
                          : view === "Chat"
                            ? "Ask about your records or log a meal in a sentence."
                            : "Your goals and preferences shape the context."}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setEditing(null);
                setModal("meal");
              }}
            >
              <Plus size={18} />
              Log food
            </button>
          </div>
          {demo ? (
            <div className="notice demo-notice">
              <span className="pill">SAMPLE MODE</span>Synthetic records for
              exploring Remy Mux. They are not your data and won’t be saved.
            </div>
          ) : connectionError ? (
            <div className="notice setup-notice">
              <Info size={18} />
              <span>{connectionError}</span>
              <a href="/login" className="text-button">
                Set up sign-in
              </a>
            </div>
          ) : (
            <div className="notice">
              <span className="pill">
                {summary.day.complete ? "LOG COMPLETE" : "LOG IN PROGRESS"}
              </span>
              {loading
                ? "Refreshing your records…"
                : `${meals.length} food entries · ${summary.day.complete ? "you marked logging complete" : "unlogged meals are unknown"}`}
            </div>
          )}
          <div className="date-toolbar">
            <div>
              <button
                aria-label="Previous day"
                onClick={() => setDate(addDays(date, -1))}
              >
                <ChevronLeft size={16} />
              </button>
              <Input
                type="date"
                aria-label="Journal date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
              <button
                aria-label="Next day"
                onClick={() => setDate(addDays(date, 1))}
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => setDate(localDate(new Date(), profile.timezone))}
              >
                Today
              </button>
            </div>
            {["Today", "Food"].includes(view) && (
              <button
                className="text-button"
                onClick={() => {
                  if (demo) {
                    toast(
                      "Import is available in your real journal after sign-in.",
                    );
                    return;
                  }
                  setModal("import");
                }}
              >
                <Upload size={15} /> Import history
              </button>
            )}
          </div>
          {view === "Today" && (
            <>
              <section className="focus-panel">
                <div className="focus-content">
                  <div className="eyebrow">
                    <Sparkles size={16} /> TODAY’S FOCUS
                  </div>
                  <h2>{brief.headline.title}</h2>
                  <p>{brief.headline.body}</p>
                  <button
                    className="dark-button"
                    onClick={() =>
                      go(profile.confirmed ? "Insights" : "Settings")
                    }
                  >
                    {profile.confirmed
                      ? "See the reasoning"
                      : "Confirm your profile"}
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="focus-aside">
                  <span className="eyebrow">CARBOHYDRATES LOGGED</span>
                  <strong>
                    {value(summary.totals.carbs)}
                    <span>g</span>
                  </strong>
                  {summary.nutrientCoverage.carbs.known > 0 &&
                    !summary.nutrientCoverage.carbs.complete && (
                      <small>
                        Known for {summary.nutrientCoverage.carbs.known}/
                        {meals.length} meals
                      </small>
                    )}
                  {summary.carbs.range ? (
                    <>
                      <p>
                        Contextual reference
                        <br />
                        <b>
                          {summary.carbs.range[0]}–{summary.carbs.range[1]} g
                          today
                        </b>
                      </p>
                      <Progress
                        aria-label="Carbohydrates against lower reference"
                        value={Math.min(
                          100,
                          ((summary.totals.carbs ?? 0) /
                            summary.carbs.range[0]) *
                            100,
                        )}
                      />
                    </>
                  ) : (
                    <p>
                      Confirm your body weight
                      <br />
                      to personalize the reference.
                    </p>
                  )}
                  <small>Broad guidance · adjust to tolerance</small>
                </div>
              </section>
              <div className="section-heading">
                <h2>Food meets training</h2>
                <span>Headline numbers, shared context</span>
              </div>
              <div className="stat-grid">
                <Metric
                  label="Intake logged"
                  amount={value(summary.totals.calories, " kcal")}
                  note={`${summary.day.complete ? "Complete" : "Partial"} log · ${summary.nutrientCoverage.calories.known}/${meals.length} meals with kcal · target ${summary.target.toLocaleString()}`}
                  icon={Utensils}
                />
                <Metric
                  label="WHOOP estimate"
                  amount={value(cycle?.kcal, " kcal")}
                  note={
                    cycle
                      ? "Latest overlapping cycle · estimated"
                      : "No WHOOP cycle recorded"
                  }
                  icon={Flame}
                />
                <Metric
                  label="Running this week"
                  amount={
                    week.count > week.missingDistance
                      ? number(week.km / 1.609344, " mi")
                      : "—"
                  }
                  note={
                    week.count
                      ? `${week.count} runs · ${week.missingDistance ? `${week.missingDistance} missing distance` : `${week.days} running days`}`
                      : "No completed runs recorded"
                  }
                  icon={Footprints}
                />
                <Metric
                  label="Next session"
                  amount={
                    next
                      ? number(
                          next.data.durationSec == null
                            ? null
                            : next.data.durationSec / 60,
                          " min",
                        )
                      : "—"
                  }
                  note={
                    next
                      ? `${next.localDate} · ${next.data.title}`
                      : "Connect or import your Runna calendar"
                  }
                  icon={CalendarDays}
                />
              </div>
              <div className="bottom-grid">
                <section className="card">
                  <div className="section-heading">
                    <h2>On your plate</h2>
                    <button className="text-button" onClick={() => go("Food")}>
                      Food journal
                    </button>
                  </div>
                  {mealList(meals)}
                  <div className="calorie-detail">
                    <span>
                      {summary.baseline.toLocaleString()} baseline{" "}
                      {summary.adjustment >= 0 ? "+" : ""}
                      {summary.adjustment} adjustment
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setModal("day")}
                    >
                      Adjust
                    </button>
                  </div>
                </section>
                <section className="card next-context">
                  <div className="section-heading">
                    <h2>Plan for what’s next</h2>
                    <Footprints size={18} />
                  </div>
                  {next ? (
                    <>
                      <span className="pill">
                        {next.localDate === addDays(date, 1)
                          ? "TOMORROW"
                          : next.localDate}
                      </span>
                      <h3>{next.data.title}</h3>
                      <p>
                        {number(
                          next.data.distanceMeters == null
                            ? null
                            : next.data.distanceMeters / 1609.344,
                          " mi",
                        )}{" "}
                        ·{" "}
                        {number(
                          next.data.durationSec == null
                            ? null
                            : next.data.durationSec / 60,
                          " min",
                        )}{" "}
                        · {next.data.intensity}
                      </p>
                      <div className="insight-note">
                        <Leaf size={18} />
                        <p>
                          Combine a familiar carbohydrate source with beans or
                          whole soy and vegetables. Choose fiber amounts you
                          tolerate near a run.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => go("Insights")}
                      >
                        Consider your fueling
                      </button>
                    </>
                  ) : (
                    <div className="next-run">
                      <h3>Your next run belongs here.</h3>
                      <p>
                        Runna’s calendar helps put your food choices in context.
                        Available details are shown as supplied.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => go("Connections")}
                      >
                        Connect your plan
                      </button>
                    </div>
                  )}
                </section>
              </div>
              {etlPanel()}
              <SourceLine
                entries={[
                  ...meals,
                  ...summary.workouts,
                  ...summary.recovery,
                  ...summary.plans,
                ]}
              />
            </>
          )}
          {view === "Food" && (
            <>
              <div className="food-summary card">
                {(
                  ["calories", "protein", "carbs", "fat", "fiber"] as const
                ).map((k) => (
                  <div key={k}>
                    <span>{k === "calories" ? "Intake logged" : k}</span>
                    <strong>
                      {number(
                        summary.totals[k],
                        k === "calories" ? " kcal" : " g",
                      )}
                    </strong>
                    {!summary.nutrientCoverage[k].complete && (
                      <small className="coverage-note">
                        {summary.nutrientCoverage[k].known}/{meals.length} meals
                        have values
                      </small>
                    )}
                  </div>
                ))}
              </div>
              <section className="card">
                <div className="section-heading">
                  <h2>{dateTitle}</h2>
                  <button
                    className="quiet-button"
                    onClick={() =>
                      void saveDay({
                        ...summary.day,
                        complete: !summary.day.complete,
                      }).catch((e) => toast.error(e.message))
                    }
                  >
                    <Check size={15} />
                    {summary.day.complete
                      ? "Reopen logging"
                      : "Finished logging"}
                  </button>
                </div>
                {mealList(meals)}
                <div className="calorie-detail">
                  <span>
                    Target = {summary.baseline} baseline{" "}
                    {summary.adjustment >= 0 ? "+" : ""}
                    {summary.adjustment} manual adjustment
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setModal("day")}
                  >
                    Edit target
                  </button>
                </div>
              </section>
              {etlPanel()}
              {savedMeals.length > 0 && (
                <section className="card">
                  <div className="section-heading">
                    <h2>Your reusable meals</h2>
                    <Bookmark size={18} />
                  </div>
                  <div className="saved-meals">
                    {savedMeals.map((m) => (
                      <button
                        className="quiet-button"
                        key={m.id}
                        onClick={() => {
                          setEditing({
                            ...m,
                            id: crypto.randomUUID(),
                            kind: "meal",
                            localDate: date,
                            revision: 0,
                            data: {
                              ...m.data,
                              mealTime: null,
                              messageTime: null,
                              workoutId: null,
                            },
                          });
                          setModal("meal");
                        }}
                      >
                        <Plus size={15} />
                        {m.data.title}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="card">
                <h2>About your REMY history</h2>
                <p className="muted">
                  Imports retain source identities and revisions. Review photos,
                  uncertain portions, and corrections against the original
                  conversation. A daily total is a summary, not another meal.
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    demo
                      ? toast("Exit sample mode to import your history.")
                      : setModal("import")
                  }
                >
                  <Upload size={16} /> Import selected history
                </button>
              </section>
            </>
          )}
          {view === "Training" && (
            <TrainingView
              entries={records}
              date={date}
              onEdit={(entry, planned) => {
                setEditing(entry ?? null);
                setModal(planned ? "plan" : "run");
              }}
              onSave={save}
            />
          )}
          {view === "Connections" && (
            <ConnectionsView
              demo={demo}
              onImport={() =>
                demo
                  ? toast("Exit sample mode to import your history.")
                  : setModal("import")
              }
              onRefresh={refresh}
            />
          )}
          {view === "Settings" && (
            <SettingsView
              entries={records}
              demo={demo}
              onSave={save}
              onRefresh={refresh}
            />
          )}
          {view === "Insights" && (
            <>
              <section className="card insight-lead">
                <span className="eyebrow">OBSERVATION · {summary.version}</span>
                <h2>{brief.headline.title}</h2>
                <p>{brief.headline.body}</p>
                {citations(brief.headline)}
              </section>
              <div className="insight-grid">
                {brief.actions.map((item, i) => (
                  <section className="card action-card" key={item.id}>
                    <span className="action-number">0{i + 1}</span>
                    <span className="eyebrow">PRACTICAL NEXT STEP</span>
                    <h2>{item.title}</h2>
                    <p>{item.body}</p>
                    {citations(item)}
                  </section>
                ))}
              </div>
              <section className="card">
                <div className="section-heading">
                  <h2>Carbohydrate context</h2>
                  <span>Daily intake and run fueling are separate</span>
                </div>
                <p>{summary.carbs.reason}</p>
                <p>
                  {summary.carbs.range
                    ? `${summary.carbs.range[0]}–${summary.carbs.range[1]} g/day (${summary.carbs.reference[0]}–${summary.carbs.reference[1]} g/kg reference). Logged: ${number(summary.carbs.gramsPerKg, " g/kg")}.`
                    : "A personalized grams-per-day range needs confirmed body weight."}
                </p>
                <p className="muted">
                  Published reference bands guide interpretation. They are not
                  automatic quotas or a diagnosis of your energy needs.
                </p>
                {next && (
                  <div className="fueling-grid">
                    {(() => {
                      const f = fuelingPlan(next.data, profile);
                      return (
                        <>
                          <div>
                            <h3>Before</h3>
                            <p>
                              {f.before
                                ? `${value(f.before[0])}–${value(f.before[1])} g over the 1–4 hours before longer exercise is a broad reference.`
                                : !profile.confirmed || !profile.weightKg
                                  ? "Confirm your weight to personalize a pre-run reference for longer exercise."
                                  : "A dedicated pre-run carbohydrate range is used for sessions longer than an hour."}
                            </p>
                          </div>
                          <div>
                            <h3>During</h3>
                            <p>
                              {f.during
                                ? `${f.during[0]}–${f.during[1]} g/hour is a duration-based reference. ${f.note}`
                                : "Duration is needed for specific fueling guidance. Shorter runs may not require extra carbohydrate."}
                            </p>
                          </div>
                          <div>
                            <h3>After</h3>
                            <p>{f.after}</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
                <a
                  className="text-button"
                  href="https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Sports nutrition reference
                </a>
              </section>
              <section className="card">
                <div className="section-heading">
                  <h2>Across your recent records</h2>
                  <div className="period-buttons">
                    {[7, 14, 28].map((p) => (
                      <button
                        className={period === p ? "active" : ""}
                        key={p}
                        onClick={() => setPeriod(p)}
                      >
                        {p} days
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const days = Array.from({ length: period }, (_, i) =>
                    summarize(records, addDays(date, -i)),
                  );
                  return (
                    <div className="period-summary">
                      <p>
                        <b>
                          {days.filter((d) => d.day.complete).length}/{period}
                        </b>{" "}
                        days marked complete
                      </p>
                      <p>
                        <b>
                          {days.filter((d) => d.meals.length).length}/{period}
                        </b>{" "}
                        days with food entries
                      </p>
                      <p className="muted">
                        Incomplete days are excluded from complete-day
                        comparisons. An association between food and a difficult
                        run would not establish a cause.
                      </p>
                    </div>
                  );
                })()}
              </section>
              <section className="card">
                <h2>What limits this view</h2>
                <ul className="limitations">
                  {summary.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="muted">
                  WHOOP cycle boundaries may differ from the food day. Wearable
                  expenditure is an estimate. Remy Mux does not diagnose low energy
                  availability or REDs.
                </p>
                <SourceLine
                  entries={records.filter((e) =>
                    summary.inputs.some((i) => i.id === e.id),
                  )}
                />
              </section>
            </>
          )}
          {view === "Chat" && (
            <section className="card chat-card">
              <div className="chat-mode">
                <Sparkles size={18} />
                <div>
                  <strong>Journal helper</strong>
                  <p>Uses shared calculations. Live OpenAI chat is deferred.</p>
                </div>
                <span className="pill">NO AI API COST</span>
              </div>
              <div className="chat-messages" aria-live="polite">
                {ofKind<any>(records, "message")
                  .filter((m) => m.localDate === date)
                  .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
                  .map((m) => (
                    <article
                      className={`chat-message ${m.data.role}`}
                      key={m.id}
                    >
                      <span>
                        {m.data.role === "user"
                          ? "You"
                          : "Remy Mux · journal helper"}
                      </span>
                      <p>{m.data.text}</p>
                      {((m.data.fingerprint &&
                        m.data.fingerprint !== summary.fingerprint) ||
                        (m.data.contextFingerprint &&
                          m.data.contextFingerprint !== brief.fingerprint)) && (
                        <small className="warning">
                          Records changed after this answer. Ask again for an
                          updated view.
                        </small>
                      )}
                      {m.data.inputs && (
                        <div className="evidence-links">
                          {m.data.inputs
                            .filter((i: any) =>
                              ["meal", "workout", "plan"].includes(i.kind),
                            )
                            .slice(0, 5)
                            .map((i: any) => (
                              <a
                                key={i.id}
                                href={`/?view=${i.kind === "meal" ? "Food" : "Training"}&date=${i.date}#${i.id}`}
                              >
                                {i.kind} · {i.date}
                              </a>
                            ))}
                        </div>
                      )}
                    </article>
                  ))}
                {!ofKind(records, "message").length && (
                  <div className="chat-welcome">
                    <span className="empty-icon">
                      <MessageCircle />
                    </span>
                    <h2>A place to connect the dots.</h2>
                    <p>
                      Ask about logged intake and upcoming runs, or write
                      “Dinner was…” to save a meal with any nutrition you
                      provide.
                    </p>
                    <div className="suggestions">
                      {[
                        "What should I eat tonight given tomorrow’s run?",
                        "How do my ETL meals fit my running?",
                        "I’m finished logging today",
                      ].map((q) => (
                        <button
                          className="quiet-button"
                          key={q}
                          onClick={() => setChat(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <form className="chat-composer" onSubmit={sendChat}>
                <Textarea
                  aria-label="Message to Remy Mux"
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                  placeholder="Ask about your day, or log a meal…"
                  maxLength={3000}
                  rows={2}
                />
                <button
                  className="primary-button"
                  aria-label="Send message"
                  disabled={chatBusy || !chat.trim()}
                >
                  <Send size={19} />
                </button>
              </form>
              <p className="microcopy">
                Nutrition values are only saved when supplied. Edit entries to
                correct ingredients or estimates. AI-generated answers are not
                enabled.
              </p>
            </section>
          )}
          <footer className="page-footer">
            <span>Built around your records. Always open to correction.</span>
            <span>REMY MUX / NUTRITION IN CONTEXT</span>
          </footer>
        </div>
      </main>
      <Toaster position="bottom-right" />
      {modal === "meal" && (
        <MealDialog
          entry={editing as Entry<Meal> | null}
          date={date}
          zone={profile.timezone}
          workouts={workouts}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "day" && (
        <DayDialog
          day={summary.day}
          onSave={saveDay}
          onClose={() => setModal(null)}
        />
      )}
      {(modal === "run" || modal === "plan") && (
        <TrainingDialog
          entry={editing ?? undefined}
          planned={modal === "plan"}
          date={date}
          zone={profile.timezone}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "import" && (
        <ImportDialog onClose={() => setModal(null)} onImported={refresh} />
      )}
      {modal === "drafts" && user && !demo && (
        <Dialog open onOpenChange={(v) => !v && setModal(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Offline drafts</DialogTitle>
              <DialogDescription>
                Review drafts before sending to your signed-in journal.
              </DialogDescription>
            </DialogHeader>
            {hasUnassignedDrafts && <div className="card">
              <p className="muted">Some drafts on this device were created while signed out. Their contents stay hidden until you confirm that you created them.</p>
              <button className="quiet-button" onClick={() => {
                try {
                  const next = claimUnassignedDeviceDrafts(drafts, user.id);
                  localStorage.setItem("remy-offline-drafts", JSON.stringify(next));
                  setDrafts(next);
                } catch (error) { toast.error(error instanceof Error ? error.message : "Could not claim these drafts."); }
              }}>Confirm these drafts are mine</button>
            </div>}
            {ownedDrafts.map((d) => (
              <div className="draft-row" key={d.id}>
                <strong>{d.data?.title ?? d.text ?? "Food draft"}</strong>
                <small>{d.localDate ?? d.queuedAt}</small>
                <button
                  className="text-button"
                  disabled={!user || demo}
                  onClick={async () => {
                    try {
                      if (d.ownerId !== user.id)
                        throw new Error(
                          "This draft belongs to a different account.",
                        );
                      if (!d.data)
                        throw new Error(
                          "Copy this draft into a new meal and review nutrition before saving.",
                        );
                      await save(d, false);
                      const next = drafts.filter((x) => x.id !== d.id);
                      setDrafts(next);
                      localStorage.setItem(
                        "remy-offline-drafts",
                        JSON.stringify(next),
                      );
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  Send to journal
                </button>
              </div>
            ))}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
