import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarBlank, CaretLeft, CaretRight, Minus, Plus } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import {
  MONTHS,
  WEEKDAYS,
  addMinutes,
  compareDay,
  formatClock,
  formatWallClock,
  monthGrid,
  nowPacific,
  parseClock,
  sameDay,
  to12h,
  to24h,
  type Clock12,
  type WallClock,
} from "../lib/datetime";

// The scrub bar covers one half of the day: twelve hours at five-minute
// resolution, with am/pm as a separate toggle. 144 steps, so the left edge is
// 12:00 and the right edge 11:55.
const STEPS = 144;
const STEP_MINUTES = 5;

// Both halves together — used to reason about "how far into the day is this",
// which is what the past-time floor is expressed in.
const DAY_STEPS = STEPS * 2;

// Interior hour ticks — the two edges are drawn by the rail itself.
const HOUR_MARKS = 11;

function clockToStep(c: Clock12): number {
  return (c.hour % 12) * 12 + Math.round(c.minute / STEP_MINUTES);
}

function stepToClock(step: number, meridiem: "am" | "pm"): Clock12 {
  const clamped = Math.min(Math.max(step, 0), STEPS - 1);
  const hour = Math.floor(clamped / 12);
  return {
    hour: hour === 0 ? 12 : hour,
    minute: (clamped % 12) * STEP_MINUTES,
    meridiem,
  };
}

/**
 * How many whole 5-minute steps into its day a wall clock sits. 0–287.
 *
 * Floors rather than rounds: this feeds the past-time cutoff, and rounding 9:13
 * up to 9:15 would declare 9:15 already gone while it is still two minutes away.
 */
function daySteps(w: WallClock): number {
  return w.hour * 12 + Math.floor(w.minute / STEP_MINUTES);
}

function stepToTime(step: number): { hour: number; minute: number } {
  return {
    hour: Math.floor(step / 12) % 24,
    minute: (step % 12) * STEP_MINUTES,
  };
}

/** Clock12 for a step-of-day (0–287). */
function dayStepToClock(step: number): Clock12 {
  const { hour, minute } = stepToTime(step);
  return { hour: hour % 12 || 12, minute, meridiem: hour >= 12 ? "pm" : "am" };
}

/**
 * Date and time for a scheduled campaign, in Pacific wall-clock.
 *
 * Renders inline: the Programar tab that holds this is already the disclosure,
 * so putting the panel behind a second trigger would cost a click for nothing.
 *
 * `value` is the chosen wall clock, or null before anything is picked — in which
 * case the panel shows the next round half hour and reports it upward on mount,
 * so what is displayed is always what would be sent. The parent converts to an
 * instant with fromPacific() only at submit.
 */
export function SchedulePicker({
  value,
  onChange,
}: {
  value: WallClock | null;
  onChange: (next: WallClock) => void;
}) {
  // Now, in Pacific, recomputed only per mount: a panel left open across a
  // 5-minute boundary is not a case worth a ticking timer.
  const today = useMemo(() => nowPacific(), []);

  // The earliest step that is still in the future, so today's dead hours can be
  // greyed out instead of picked and then rejected. +1 excludes the step now
  // falls inside — by the time you click it, it has passed.
  const floorToday = useMemo(
    () => Math.min(daySteps(today) + 1, DAY_STEPS),
    [today]
  );

  // After 23:55 there is no step left today at all, so today itself is closed.
  const todayIsFull = floorToday >= DAY_STEPS;

  // Default to the next round half hour rather than this instant — nobody
  // schedules a blast for 4:37. Computed unconditionally: `value ?? useMemo(…)`
  // would short-circuit the hook.
  const fallback = useMemo(() => roundUpToHalfHour(today), [today]);
  const current = value ?? fallback;

  // The floor that applies to whatever day is selected: today's cutoff on today,
  // none on any later day.
  const floorStep = sameDay(current, today) ? floorToday : 0;

  // Publish the default so the parent is never holding null while the panel
  // shows a concrete time — otherwise Programar looks ready but submit is
  // blocked, with nothing on screen explaining why.
  useEffect(() => {
    if (!value) onChange(fallback);
  }, [value, fallback, onChange]);

  // Which month the grid is showing, independent of what is selected.
  const [view, setView] = useState({ year: current.year, month: current.month });

  const clock = to12h(current);

  const setClock = useCallback(
    (c: Clock12) => onChange({ ...current, ...to24h(c) }),
    [current, onChange]
  );

  /**
   * Pick a day. Switching from a future day to today can leave the held time
   * behind the cutoff (9:00 am selected, then today picked at 4pm), so the time
   * moves up to the first step still available.
   */
  const selectDay = useCallback(
    (day: number) => {
      const next: WallClock = { ...current, year: view.year, month: view.month, day };
      const nextFloor = sameDay(next, today) ? floorToday : 0;
      if (daySteps(next) < nextFloor) Object.assign(next, stepToTime(nextFloor));
      onChange(next);
    },
    [current, view.year, view.month, today, floorToday, onChange]
  );

  const grid = monthGrid(view.year, view.month);
  // Grey out months entirely in the past rather than letting someone page back
  // to a wall of dead days.
  const canGoBack =
    view.year > today.year || (view.year === today.year && view.month > today.month);

  function moveMonth(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  return (
    // A sunken well rather than another floating card: this is content inside
    // the composer's card, not a surface on top of it.
    <div className="rounded-[var(--r-core)] bg-[var(--surface)] p-4">
      <p className="mb-3 flex flex-wrap items-baseline gap-x-1.5 text-xs text-[var(--text-muted)]">
        <CalendarBlank size={14} weight="light" aria-hidden="true" />
        Se enviará el{" "}
        <span className="font-medium text-[var(--text-primary)]">
          {formatWallClock(current)}
        </span>{" "}
        · hora del Pacífico
      </p>

      {/* The calendar and the clock sit side by side once there is room for
          both, which is the two-pane split the original design used. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="sm:w-[17rem] sm:shrink-0">
          <div className="mb-1 flex items-center justify-between">
            <IconButton
              label="Mes anterior"
              onClick={() => moveMonth(-1)}
              disabled={!canGoBack}
            >
              <CaretLeft size={16} weight="bold" />
            </IconButton>
            <span className="text-sm font-medium capitalize tabular-nums">
              {MONTHS[view.month]} {view.year}
            </span>
            <IconButton label="Mes siguiente" onClick={() => moveMonth(1)}>
              <CaretRight size={16} weight="bold" />
            </IconButton>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAYS.map((d) => (
              <span key={d} className="py-1 text-[11px] text-[var(--text-muted)]">
                {d}
              </span>
            ))}
            {Array.from({ length: grid.blanks }, (_, i) => (
              <span key={`blank-${i}`} aria-hidden="true" />
            ))}
            {grid.days.map((day) => {
              const cell = { ...view, day, hour: 0, minute: 0 };
              // Today counts as past once its last 5-minute step is gone, so it
              // cannot be selected into a state with no valid time.
              const past =
                compareDay(cell, today) < 0 ||
                (sameDay(cell, today) && todayIsFull);
              const selected = sameDay(cell, current);
              return (
                <div key={day} className="flex justify-center py-0.5">
                  <button
                    type="button"
                    disabled={past}
                    aria-pressed={selected}
                    onClick={() => selectDay(day)}
                    className={cn(
                      "group relative grid size-9 place-items-center rounded-full text-sm tabular-nums outline-none",
                      past
                        ? "cursor-default text-[var(--text-muted)]/40"
                        : "cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                      selected && "font-medium text-white",
                      !past && !selected && "text-[var(--text-primary)]"
                    )}
                  >
                    {/* A real element, not a ::before with a negative z-index —
                        that escapes the button (position:relative with z-index
                        auto is not a stacking context) and paints behind the
                        panel's own background, which hid the circle entirely.
                        Both this and the number are positioned, so DOM order
                        alone stacks them and no z-index is needed.

                        scale(0.75) -> scale(1) with a touch of overshoot, from
                        the original design. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0 rounded-full transition-[transform,background-color] duration-[250ms] ease-[cubic-bezier(0.7,-0.12,0.2,1.12)]",
                        selected
                          ? "scale-100 bg-[var(--brand)]"
                          : "scale-75 bg-transparent",
                        !past && !selected && "group-hover:scale-100 group-hover:bg-[var(--brand)]/15"
                      )}
                    />
                    <span className="relative">{day}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1 border-t border-[var(--border)] pt-4 sm:border-t-0 sm:pt-0">
          <TimeScrubber clock={clock} floorStep={floorStep} onChange={setClock} />
        </div>
      </div>
    </div>
  );
}

/**
 * The hour rail. Dragging sets the time directly; the handle carries its own
 * label so the value stays under the finger on a touch screen.
 *
 * `floorStep` is the earliest step-of-day still in the future (0 when the
 * selected day is not today). Everything below it is greyed out and unreachable
 * by drag, by the −/+ buttons, or by typing — a time in the past is never
 * selectable, so there is nothing to warn about after the fact.
 */
function TimeScrubber({
  clock,
  floorStep,
  onChange,
}: {
  clock: Clock12;
  floorStep: number;
  onChange: (c: Clock12) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const step = clockToStep(clock);
  const pct = (step / STEPS) * 100;

  // The floor is a step-of-day; the rail shows one half, so shift it into rail
  // coordinates and clamp. 0 means the whole rail is open, STEPS means none of it.
  const half = clock.meridiem === "pm" ? STEPS : 0;
  const railFloor = Math.min(Math.max(floorStep - half, 0), STEPS);
  const deadPct = (railFloor / STEPS) * 100;

  // Which halves of the day still hold a selectable step.
  const amClosed = floorStep >= STEPS;
  const pmClosed = floorStep >= DAY_STEPS;

  const setFromX = useCallback(
    (clientX: number) => {
      const box = rail.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      const ratio = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
      const wanted = Math.round(ratio * STEPS);
      // Clamp rather than ignore, so dragging into the dead zone parks the
      // handle at the earliest allowed time instead of feeling stuck.
      onChange(stepToClock(Math.max(wanted, railFloor), clock.meridiem));
    },
    [clock.meridiem, railFloor, onChange]
  );

  // Pointer capture rather than window-level listeners: the browser routes every
  // move and the release to this element, so a drag that leaves the panel still
  // tracks and still ends. Also collapses mouse and touch into one path.
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFromX(e.clientX);
  }

  return (
    // The parent draws whatever divider the layout needs, so nothing here
    // assumes it sits below the calendar rather than beside it.
    <div className="pt-1">
      <div
        ref={rail}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragging && setFromX(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className={cn(
          "relative mx-1 h-10 touch-none select-none",
          railFloor >= STEPS ? "cursor-default" : "cursor-ew-resize"
        )}
      >
        {/* Rail, with a taller tick at each end. */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--brand)]/30">
          <span
            className={cn(
              "absolute -top-1.5 left-0 h-2.5 w-0.5",
              railFloor > 0 ? "bg-[var(--text-muted)]/25" : "bg-[var(--brand)]"
            )}
          />
          <span
            className={cn(
              "absolute -top-1.5 right-0 h-2.5 w-0.5",
              railFloor >= STEPS ? "bg-[var(--text-muted)]/25" : "bg-[var(--brand)]"
            )}
          />
          {/* Hours already gone: muted over the rail so the reachable stretch is
              obvious before you try to drag into it. */}
          {railFloor > 0 && (
            <span
              className="absolute inset-y-0 left-0 bg-[var(--text-muted)]/25"
              style={{ width: `${deadPct}%` }}
            />
          )}
        </div>

        {/* Interior hour marks; every third is taller, as in the original. */}
        <div className="absolute inset-x-0 bottom-0.5 h-2">
          {Array.from({ length: HOUR_MARKS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "absolute bottom-0 w-0.5 -translate-x-1/2",
                (i + 1) % 3 === 0 ? "h-1.5" : "h-1",
                (i + 1) * 12 < railFloor
                  ? "bg-[var(--text-muted)]/25"
                  : "bg-[var(--brand)]/40"
              )}
              style={{ left: `${((i + 1) / 12) * 100}%` }}
            />
          ))}
        </div>

        {/* Teardrop handle. The rotated square gives the point at bottom-right;
            the label sits in an unrotated child so the text stays upright. */}
        <div
          className={cn(
            "absolute bottom-2 grid size-10 -translate-x-1/2 place-items-center",
            !dragging && "transition-transform duration-[400ms] ease-[var(--ease-mass)]"
          )}
          style={{ left: `${pct}%` }}
        >
          <span className="absolute inset-0 -z-10 rotate-45 rounded-[1.25rem_1.25rem_0.2rem_1.25rem] bg-[var(--brand)]" />
          <span className="text-[10px] font-medium leading-none text-white tabular-nums">
            {clock.hour}:{String(clock.minute).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Wraps rather than overflows: this column is whatever is left beside the
          calendar, which on a narrow desktop is not much. The gap clears the
          handle's point, which hangs below the rail line. */}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <IconButton
          label="Cinco minutos antes"
          // Stepping back off the floor would land in the past, so the control
          // goes dead at the boundary instead of producing a rejected value.
          disabled={step <= railFloor}
          onClick={() => onChange(shift(clock, -STEP_MINUTES))}
        >
          <Minus size={14} weight="bold" />
        </IconButton>

        <TimeInput clock={clock} floorStep={floorStep} onChange={onChange} />

        <IconButton
          label="Cinco minutos después"
          onClick={() => onChange(shift(clock, STEP_MINUTES))}
        >
          <Plus size={14} weight="bold" />
        </IconButton>

        <div className="flex overflow-hidden rounded-full border border-[var(--border)]">
          {(["am", "pm"] as const).map((m) => {
            // A half of the day with no step left cannot be switched to at all.
            const closed = m === "am" ? amClosed : pmClosed;
            return (
              <button
                key={m}
                type="button"
                disabled={closed}
                aria-pressed={clock.meridiem === m}
                onClick={() => {
                  // Crossing into a half whose start is already past lands on
                  // its first available step rather than on the same o'clock.
                  const target = m === "am" ? 0 : STEPS;
                  const wanted = Math.max(step + target, floorStep);
                  onChange(stepToClock(wanted - target, m));
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                  closed && "cursor-default text-[var(--text-muted)]/40",
                  !closed && clock.meridiem === m && "bg-[var(--brand)] text-white",
                  !closed &&
                    clock.meridiem !== m &&
                    "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Type the time instead of scrubbing for it. Held as free text while focused so
 * a half-typed "4:" is not thrown away, then parsed on blur or Enter — the
 * original validated digit-by-digit against a rule that disagreed with how it
 * rendered them, and committed the wrong hour as a result.
 */
function TimeInput({
  clock,
  floorStep,
  onChange,
}: {
  clock: Clock12;
  floorStep: number;
  onChange: (c: Clock12) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const parsed = parseClock(draft, clock.meridiem);
    // Unparseable input reverts rather than guessing; the scrubber above still
    // shows what is actually selected. A time before the floor reverts for the
    // same reason — typing is not a way around the greyed-out hours.
    if (parsed) {
      const { hour, minute } = to24h(parsed);
      // Snap up onto the panel's 5-minute grid, so a typed 9:13 becomes 9:15
      // rather than parking the handle between steps. Ceiling, not rounding —
      // snapping must never move a time backwards into the dead zone.
      const step = Math.ceil((hour * 60 + minute) / STEP_MINUTES);
      // Past the floor, and still inside the same day.
      if (step >= floorStep && step < DAY_STEPS) onChange(dayStepToClock(step));
    }
    setDraft(null);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label="Hora"
      value={draft ?? formatClock(clock)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setDraft(formatClock(clock));
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-center text-sm tabular-nums outline-none focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/30"
    />
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Steps a 12-hour clock by minutes, rolling am/pm across noon and midnight. */
function shift(c: Clock12, delta: number): Clock12 {
  const { hour, minute } = to24h(c);
  const next = addMinutes({ year: 2000, month: 0, day: 2, hour, minute }, delta);
  return to12h(next);
}

function roundUpToHalfHour(w: WallClock): WallClock {
  const over = w.minute % 30;
  return addMinutes(w, over === 0 ? 30 : 30 - over);
}
