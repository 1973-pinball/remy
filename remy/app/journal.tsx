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
  ShieldCheck,
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
import { CoachView } from "./coach";
import { LogFoodDialog } from "./log-food";
import { HistoricalNutritionTable, HistoricalSummaryNotice } from "./historical-nutrition";
import { NutritionTrends } from "./nutrition-trends";
import { TodayOverview } from "./today-overview";
import { HistoryExertion } from "./history-exertion";
import { MealPhoto } from "./meal-photo";
import { COACH_TARGETS } from "@/lib/coach-context";
import { journalDestination, type JournalView, type JournalUtility } from "@/lib/journal-navigation";
import layout from "./journal-layout.module.css";
import { ownedDeviceDrafts, claimUnassignedDeviceDrafts } from "@/lib/device-drafts";
import { nextMealSuggestion } from "@/lib/next-meal";
import {
  summarize,
  ofKind,
  localDate,
  addDays,
  round,
  type Entry,
  type Meal,
  type Workout,
  type Day,
} from "@/lib/domain";
import { sampleEntries } from "@/lib/fixtures";
import { insights, type InsightItem } from "@/lib/insights";
type View = JournalView;
const nav = [
  ["Today", Sun],
  ["History", CalendarDays],
] as const;
const value = (n: number | null | undefined, unit = "") =>
  n == null ? "—" : `${Math.round(n).toLocaleString()}${unit}`;
const number = (n: number | null | undefined, unit = "") =>
  n == null ? "—" : `${round(n).toLocaleString()}${unit}`;

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
  const refreshVersion = useRef(0);
  const [view, setView] = useState<View>("Today"),
    [utility, setUtility] = useState<JournalUtility>(null),
    [section, setSection] = useState<ReturnType<typeof journalDestination>["section"]>(null),
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
    [drafts, setDrafts] = useState<any[]>([]);
  const ownedDrafts = ownedDeviceDrafts(drafts, user?.id ?? null);
  const hasUnassignedDrafts = !!user && drafts.some((draft) => draft && draft.ownerId == null);
  const records = demo ? demoEntries : entries,
    summary = useMemo(() => summarize(records, date), [records, date]),
    nextMeal = useMemo(() => nextMealSuggestion(summary), [summary]),
    brief = useMemo(() => insights(records, date), [records, date]),
    profile = summary.profile,
    workouts = ofKind<Workout>(records, "workout"),
    savedMeals = ofKind<Meal>(records, "savedMeal");
  const clearPrivateView = useCallback(() => {
    refreshVersion.current++;
    setEntries([]);
    setUser(null);
    setEditing(null);
    setModal(null);
    setUtility(null);
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
    const destination = journalDestination(url.searchParams.get("view"));
    setView(destination.view);
    setUtility(destination.utility ?? journalDestination(url.searchParams.get("utility")).utility);
    setSection(destination.section);
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
  const selectDate = (selectedDate: string, selectedView: string = view, recordId?: string) => {
    const destination = journalDestination(selectedView);
    setDate(selectedDate);
    setView(destination.utility ? view : destination.view);
    setUtility(destination.utility);
    setSection(destination.section);
    setOpenMobile(false);
    const u = new URL(window.location.href);
    u.searchParams.set("view", destination.utility ? view : destination.view);
    if (destination.utility) u.searchParams.set("utility", destination.utility);
    else u.searchParams.delete("utility");
    u.searchParams.set("date", selectedDate);
    if (recordId) u.searchParams.set("record", recordId);
    else u.searchParams.delete("record");
    u.hash = recordId ? encodeURIComponent(recordId) : "";
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
  };
  const go = (v: string) => selectDate(date, v);
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
  const meals = summary.meals;
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
              {m.data.photoId && <MealPhoto entryId={m.id} title={m.data.title} />}
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
                      data: { ...m.data, photoId: undefined },
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
    ) : summary.nutritionSource === "historical-summary" ? (
      <div className="empty-block historical-meals-empty">
        <h3>Meal details are not available for this date.</h3>
        <p>Your historical daily estimate is shown in the totals above. New meal entries become the source of totals for the whole date.</p>
        <button className="text-button" onClick={() => { setEditing(null); setModal("meal"); }}>
          Add meal details <Plus size={16} />
        </button>
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
            <Leaf size={18} /> Eat to Live · {date}
          </h2>
          <span>{summary.nutritionSource === "historical-summary" ? "Historical daily estimate · coverage unknown" : "From individual meals"}</span>
        </div>
        <div className="etl-grid">
          {etlFields.slice(0, 10).map(([key, label, unit]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>
                {number(summary.etl[key]?.value)}
                <small>{unit}</small>
              </strong>
              {key in COACH_TARGETS && <small className="coverage-note">Usual range {COACH_TARGETS[key as keyof typeof COACH_TARGETS].join("–")} {unit}</small>}
              {summary.nutritionSource !== "historical-summary" && summary.etl[key] &&
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
          {summary.nutritionSource === "historical-summary"
            ? "A dash means the source did not provide a value. These are historical daily estimates; meal coverage is unknown."
            : "A dash means unknown. Partial sums show their coverage. Your usual ranges are preferences for maintenance and training, not required quotas or restrictive caps."}
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
              selectDate(l.date ?? date, u.searchParams.get("view") as View, l.id);
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
                  <span>{label}</span>
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
          <details className={layout.utility}>
            <summary><Settings size={17} /> Settings</summary>
            <div className={layout.utilityMenu}>
              <button onClick={() => go("Connections")}><Plug size={15} /> Connections</button>
              <button onClick={() => go("Settings")}><Settings size={15} /> Profile & goals</button>
              <button onClick={() => demo ? toast("Exit sample mode to import your history.") : setModal("import")}><Upload size={15} /> Import history</button>
            </div>
          </details>
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
              <h1>{view === "Today" ? "Food for the work ahead." : "Your history, in context."}</h1>
              <p>{view === "Today" ? "Your next meal, daily totals, and running — together." : "Food, ETL preferences, running and recovery over time."}</p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setEditing(null);
                setModal("meal");
              }}
            >
              <Plus size={18} />
              Log food or photo
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
          ) : loading ? <p className="microcopy">Refreshing your records…</p> : null}
          <div className="date-toolbar">
            <div>
              <button
                aria-label="Previous day"
                onClick={() => selectDate(addDays(date, -1))}
              >
                <ChevronLeft size={16} />
              </button>
              <Input
                type="date"
                aria-label="Journal date"
                value={date}
                onChange={(e) => e.target.value && selectDate(e.target.value)}
              />
              <button
                aria-label="Next day"
                onClick={() => selectDate(addDays(date, 1))}
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => selectDate(localDate(new Date(), profile.timezone))}
              >
                Today
              </button>
            </div>
            {view === "History" && (
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
          {view === "Today" ? <>
            <section className={layout.nextMeal} aria-labelledby="next-meal-heading">
              <div><p className="eyebrow"><Sparkles size={14} /> WHAT TO EAT NEXT</p>
                <h2 id="next-meal-heading">{nextMeal.title}</h2>
                <p>{nextMeal.body}</p>
                <span>{nextMeal.note}</span>
              </div>
              <button className="quiet-button" onClick={() => { setSection("coach"); requestAnimationFrame(() => document.getElementById("ask-remy")?.scrollIntoView({behavior:"smooth",block:"start"})); }}>Ask Remy <MessageCircle size={16}/></button>
            </section>
            <TodayOverview records={records} date={date} onAdjust={() => setModal("day")} onConnections={() => go("Connections")} />
            <details id="ask-remy" className={`card ${layout.disclosure}`} open={section === "coach"} onToggle={e => { if(!e.currentTarget.open && section === "coach") setSection(null); }}>
              <summary onClick={e => { e.preventDefault(); setSection(section === "coach" ? null : "coach"); }}><span><MessageCircle size={18}/> Ask Remy <small>Personal guidance, photos & meal review</small></span></summary>
              <CoachView compact key={`${user?.id ?? "signed-out"}:${date}:${demo}`} records={records} date={date} demo={demo} authenticated={!!user} onChanged={refresh}/>
            </details>
            {(meals.length > 0 || summary.nutritionSource === "historical-summary") && <details className={`card ${layout.disclosure}`}>
              <summary><span><Utensils size={18}/> Food recorded <small>{meals.length ? `${meals.length} meals` : "Historical daily estimate"}</small></span></summary>
              {summary.historicalSummary && <HistoricalSummaryNotice entry={summary.historicalSummary} active={summary.nutritionSource === "historical-summary"}/>}
              {mealList(meals)}
              <div className="completion-row"><button className="quiet-button" onClick={() => void saveDay({...summary.day, complete:!summary.day.complete}).catch(e => toast.error(e.message))}><Check size={15}/>{summary.day.complete ? "Reopen food log" : "Mark food log complete"}</button><button className="text-button" onClick={() => go("Food")}>Food history & ETL</button></div>
            </details>}
          </> : <>
            <NutritionTrends records={records} selectedDate={date} onOpenDate={historyDate => selectDate(historyDate,"Food")}/>
            <HistoryExertion records={records} selectedDate={date}/>
            {etlPanel()}
            <details className={`card ${layout.disclosure}`}>
              <summary><span><CalendarDays size={18}/> Imported source summaries <small>Original daily estimates</small></span></summary>
              <HistoricalNutritionTable records={records} selectedDate={date} onOpenDate={historyDate => {selectDate(historyDate,"Food"); requestAnimationFrame(() => document.getElementById("food-journal")?.scrollIntoView({behavior:"smooth",block:"start"})); }}/>
            </details>
            <details id="food-journal" className={`card ${layout.disclosure}`} open={section === "food"} onToggle={e => { if(!e.currentTarget.open && section === "food")setSection(null); }}>
              <summary onClick={e => {e.preventDefault();setSection(section === "food" ? null : "food");}}><span><Utensils size={18}/> Food journal <small>{date} · {meals.length} meals</small></span></summary>
              {summary.historicalSummary && <HistoricalSummaryNotice entry={summary.historicalSummary} active={summary.nutritionSource === "historical-summary"}/>}{mealList(meals)}
              <div className="completion-row"><button className="quiet-button" onClick={() => void saveDay({...summary.day,complete:!summary.day.complete}).catch(e=>toast.error(e.message))}><Check size={15}/>{summary.day.complete ? "Reopen food log" : "Mark food log complete"}</button><button className="text-button" onClick={() => setModal("day")}>Daily target</button></div>
              {savedMeals.length > 0 && <div className={layout.savedMeals}><h3>Reusable meals</h3><div className="saved-meals">{savedMeals.map(m => <button className="quiet-button" key={m.id} onClick={() => {setEditing({...m,id:crypto.randomUUID(),kind:"meal",localDate:date,revision:0,data:{...m.data,photoId:undefined,mealTime:null,messageTime:null,workoutId:null}});setModal("meal");}}><Plus size={15}/>{m.data.title}</button>)}</div></div>}
            </details>
            <details className={`card ${layout.disclosure}`} open={section === "training"} onToggle={e=>{if(!e.currentTarget.open&&section === "training")setSection(null);}}>
              <summary onClick={e=>{e.preventDefault();setSection(section === "training" ? null : "training");}}><span><Footprints size={18}/> Running & plans <small>Browse or add activity</small></span></summary>
              <TrainingView entries={records} date={date} onEdit={(entry,planned)=>{setEditing(entry??null);setModal(planned?"plan":"run");}} onSave={save}/>
            </details>
            <details className={`card ${layout.disclosure}`} open={section === "insights"} onToggle={e=>{if(!e.currentTarget.open&&section === "insights")setSection(null);}}>
              <summary onClick={e=>{e.preventDefault();setSection(section === "insights" ? null : "insights");}}><span><Sparkles size={18}/> More context <small>Fueling, observations & sources</small></span></summary>
              <div className={layout.historyDetail}><h3>{brief.headline.title}</h3><p>{brief.headline.body}</p>{citations(brief.headline)}
                {[...brief.actions,...brief.observations].map(item=><article key={item.id}><h3>{item.title}</h3><p>{item.body}</p>{citations(item)}{item.references.map(reference=><a className="reference-link" key={reference.url} href={reference.url} target="_blank" rel="noreferrer">{reference.title} ↗</a>)}</article>)}
                <article><h3>Carbohydrate context</h3><p>{summary.carbs.reason}</p><p>{summary.carbs.range ? `${summary.carbs.range[0]}–${summary.carbs.range[1]} g/day is a broad training reference, not a required quota.` : "Confirm your current weight in your profile to personalize gram references."}</p></article>
                <details><summary>Coverage and limitations</summary>{brief.limitations.map(note=><p key={note}>{note}</p>)}<SourceLine entries={records.filter(e=>summary.inputs.some(i=>i.id===e.id))}/></details>
              </div>
            </details>
          </>}
          <footer className="page-footer">
            <span>Built around your records. Always open to correction.</span>
            <span>REMY MUX / NUTRITION IN CONTEXT</span>
          </footer>
        </div>
      </main>
      <Toaster position="bottom-right" />
      {utility && <Dialog open onOpenChange={open=>{if(!open)selectDate(date,view);}}>
        <DialogContent className={layout.utilityDialog}><DialogHeader><DialogTitle>{utility === "Connections" ? "Connections" : "Your profile & goals"}</DialogTitle><DialogDescription>{utility === "Connections" ? "Manage your running and recovery sources." : "Preferences that shape your food and training context."}</DialogDescription></DialogHeader>
          {utility === "Connections" ? <ConnectionsView demo={demo} onImport={()=>{if(demo)toast("Exit sample mode to import your history.");else{setUtility(null);setModal("import");}}} onRefresh={refresh}/> : <SettingsView entries={records} demo={demo} onSave={save} onRefresh={refresh}/>}
        </DialogContent>
      </Dialog>}

      {modal === "meal" && editing && (
        <MealDialog
          entry={editing as Entry<Meal> | null}
          date={date}
          zone={profile.timezone}
          workouts={workouts}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "meal" && !editing && <LogFoodDialog key={`${user?.id ?? "guest"}:${date}:${demo}`} date={date} zone={profile.timezone} records={records} workouts={workouts} demo={demo} authenticated={!!user} onSave={save} onChanged={refresh} onClose={() => setModal(null)} />}
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
