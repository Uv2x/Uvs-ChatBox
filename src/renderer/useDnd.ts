import { useState, useCallback } from 'react';

/** Tiny native HTML5 drag-and-drop hook for vertical/grid list reorders.
 *
 *  Usage:
 *    const dnd = useDnd((from, to) => reorder(from, to));
 *    items.map((id, i) => (
 *      <div
 *        key={id}
 *        draggable
 *        {...dnd.bind(i)}
 *        className={dnd.draggedIndex === i ? 'dragging' : ''}
 *      />
 *    ))
 *
 *  Why a hook and not a library: we already have multiple lists that
 *  reorder via ▲▼ arrows. A library (dnd-kit, react-dnd) would pull in
 *  ~80 KB and force a refactor. Native HTML5 DnD is ~50 lines and good
 *  enough for vertical lists where you don't need touch gestures.
 *
 *  Index-based: we work in positions and let the caller's
 *  onReorder(fromIdx, toIdx) do the actual data move. */
export function useDnd(onReorder: (fromIndex: number, toIndex: number) => void) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const bind = useCallback(
    (idx: number) => ({
      onDragStart: (e: React.DragEvent) => {
        setDraggedIndex(idx);
        // Required for Firefox to actually start the drag.
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
      },
      onDragOver: (e: React.DragEvent) => {
        // Without preventDefault, onDrop never fires.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overIndex !== idx) setOverIndex(idx);
      },
      onDragLeave: () => {
        if (overIndex === idx) setOverIndex(null);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const from = draggedIndex ?? Number(e.dataTransfer.getData('text/plain'));
        if (Number.isFinite(from) && from !== idx) onReorder(from, idx);
        setDraggedIndex(null);
        setOverIndex(null);
      },
      onDragEnd: () => {
        setDraggedIndex(null);
        setOverIndex(null);
      },
    }),
    [draggedIndex, overIndex, onReorder],
  );

  return { bind, draggedIndex, overIndex };
}

/** Move an array element from `fromIndex` to `toIndex`, returning a NEW
 *  array. Pure function; safe for React state. */
export function arrayMove<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return arr;
  if (fromIndex < 0 || fromIndex >= arr.length) return arr;
  if (toIndex < 0 || toIndex >= arr.length) return arr;
  const next = [...arr];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved as T);
  return next;
}
