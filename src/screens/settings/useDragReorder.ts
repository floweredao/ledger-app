import { type CSSProperties, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

/** Elements taking part in a drag carry `data-reorder-id`; for a root that is its whole group, children their row. */
const elementOf = (id: string) => document.querySelector<HTMLElement>(`[data-reorder-id="${CSS.escape(id)}"]`);
const EDGE = 72;

type Gesture = {
  readonly pointerId: number;
  readonly siblings: readonly string[];
  readonly from: number;
  readonly mids: readonly number[];
  readonly shift: number;
  readonly startY: number;
  clientY: number;
  frame: number | null;
};
export type DragPreview = { readonly id: string; readonly dy: number; readonly from: number; readonly to: number };

function targetIndex(mids: readonly number[], from: number, center: number): number {
  let to = from;
  for (let i = from + 1; i < mids.length; i++) if (center > (mids[i] ?? 0)) to = i;
  for (let i = from - 1; i >= 0; i--) if (center < (mids[i] ?? 0)) to = i;
  return to;
}

/**
 * Pointer (mouse, touch, pen) drag on a handle: the item lifts and follows the pointer, siblings step aside to show
 * where it will land, the page scrolls near the viewport edges, and release commits the new sibling order.
 * Cancel restores the previous order. The arrow buttons stay as the non-drag alternative.
 */
export function useDragReorder(onCommit: (ids: string[]) => void) {
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [siblings, setSiblings] = useState<readonly string[]>([]);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const update = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    const dy = g.clientY + window.scrollY - g.startY;
    const center = (g.mids[g.from] ?? 0) + dy;
    const id = g.siblings[g.from] ?? "";
    setPreview({ id, dy, from: g.from, to: targetIndex(g.mids, g.from, center) });
  }, []);

  const stop = useCallback((save: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    const center = (g.mids[g.from] ?? 0) + g.clientY + window.scrollY - g.startY;
    const to = targetIndex(g.mids, g.from, center);
    setPreview(null);
    setSiblings([]);
    if (!save || to === g.from) return;
    const ids = [...g.siblings];
    const [moved] = ids.splice(g.from, 1);
    if (moved === undefined) return;
    ids.splice(to, 0, moved);
    commit.current(ids);
  }, []);

  const scroll = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    const speed =
      g.clientY < EDGE
        ? -(EDGE - g.clientY) / 4
        : g.clientY > innerHeight - EDGE
          ? (g.clientY - innerHeight + EDGE) / 4
          : 0;
    if (speed !== 0) {
      window.scrollBy(0, speed);
      update();
    }
    g.frame = requestAnimationFrame(scroll);
  }, [update]);

  useEffect(() => () => stop(false), [stop]);

  const handleProps = (id: string, group: readonly string[]) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || gesture.current) return;
      const rects = group.map((item) => elementOf(item)?.getBoundingClientRect());
      const from = group.indexOf(id);
      if (from === -1 || rects.some((rect) => rect === undefined)) return;
      const boxes = rects as DOMRect[];
      const own = boxes[from] as DOMRect;
      const neighbor = boxes[from + 1] ?? boxes[from - 1];
      const gap = neighbor
        ? Math.max(0, neighbor.top > own.top ? neighbor.top - own.bottom : own.top - neighbor.bottom)
        : 0;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.current = {
        pointerId: event.pointerId,
        siblings: group,
        from,
        mids: boxes.map((rect) => rect.top + window.scrollY + rect.height / 2),
        shift: own.height + gap,
        startY: event.clientY + window.scrollY,
        clientY: event.clientY,
        frame: null,
      };
      setSiblings(group);
      update();
      gesture.current.frame = requestAnimationFrame(scroll);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId) return;
      g.clientY = event.clientY;
      update();
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId) return;
      g.clientY = event.clientY;
      stop(true);
    },
    onPointerCancel: () => stop(false),
    onKeyDown(event: { key: string }) {
      if (event.key === "Escape") stop(false);
    },
  });
  const itemProps = (id: string): { style?: CSSProperties; "data-dragging"?: "true" } => {
    if (!preview) return {};
    if (id === preview.id) return { style: { transform: `translateY(${preview.dy}px)` }, "data-dragging": "true" };
    const index = siblings.indexOf(id);
    const shift = gesture.current?.shift ?? 0;
    if (index === -1) return {};
    if (preview.from < preview.to && index > preview.from && index <= preview.to)
      return { style: { transform: `translateY(${-shift}px)` } };
    if (preview.to < preview.from && index >= preview.to && index < preview.from)
      return { style: { transform: `translateY(${shift}px)` } };
    return {};
  };

  return { active: preview !== null, handleProps, itemProps };
}
