import { X } from "lucide-react";
import {
  type AnimationEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE_FALLBACK_MS = 260;
const DRAG_CLOSE_PX = 96;

const stack: string[] = [];

export type SheetProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** `sheet`: bottom sheet below 900px, centred dialog above. `dialog`: always centred. */
  readonly variant?: "sheet" | "dialog";
  readonly role?: "dialog" | "alertdialog";
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
};

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute("tabindex") !== "-1" && !el.closest("[hidden]"),
  );
}

export function Sheet(props: SheetProps) {
  const [rendered, setRendered] = useState(props.open);
  useEffect(() => {
    if (props.open) setRendered(true);
  }, [props.open]);
  if (!rendered && !props.open) return null;
  return createPortal(<SheetPanel {...props} onExited={() => setRendered(false)} />, document.body);
}

function SheetPanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "sheet",
  role = "dialog",
  initialFocusRef,
  onExited,
}: SheetProps & { readonly onExited: () => void }) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; startAt: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(id);
    document.documentElement.classList.add("sheet-open");
    const panel = panelRef.current;
    if (panel) {
      const body = panel.querySelector<HTMLElement>(".sheet-body");
      const target = initialFocusRef?.current ?? (body ? focusables(body)[0] : undefined) ?? panel;
      target.focus();
    }
    return () => {
      const index = stack.lastIndexOf(id);
      if (index !== -1) stack.splice(index, 1);
      if (stack.length === 0) document.documentElement.classList.remove("sheet-open");
      const back = returnFocusRef.current;
      if (back?.isConnected) back.focus();
    };
  }, [open, id, initialFocusRef]);

  useEffect(() => {
    if (open) return;
    const timer = setTimeout(onExited, CLOSE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [open, onExited]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== id) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = focusables(panelRef.current);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, id]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const panel = panelRef.current;
    if (!open || !viewport || !panel) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      panel.style.setProperty("--kb-inset", `${Math.round(inset)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { startY: event.clientY, startAt: event.timeStamp };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current) setDragY(Math.max(0, event.clientY - drag.current.startY));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    const distance = Math.max(0, event.clientY - start.startY);
    const velocity = distance / Math.max(1, event.timeStamp - start.startAt);
    setDragY(0);
    if (distance > DRAG_CLOSE_PX || velocity > 0.5) onClose();
  };

  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const panelProps = {
    ref: panelRef,
    className: "sheet-panel",
    "aria-labelledby": titleId,
    "aria-describedby": description ? descriptionId : undefined,
    tabIndex: -1,
    style: dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined,
    onAnimationEnd: (event: AnimationEvent<HTMLDivElement>) => {
      if (!open && event.target === event.currentTarget) onExited();
    },
  };
  const content = (
    <>
      {variant === "sheet" ? (
        <button
          type="button"
          className="sheet-grabber"
          tabIndex={-1}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      ) : null}
      <header className="sheet-header">
        <h2 className="sheet-title" id={titleId}>
          {title}
        </h2>
        <IconButton label="닫기" icon={X} onClick={onClose} />
      </header>
      {description ? (
        <p className="sheet-description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <div className="sheet-body">{children}</div>
      {footer ? <div className="sheet-footer">{footer}</div> : null}
    </>
  );
  return (
    <div className="sheet-root" data-variant={variant} data-state={open ? "open" : "closing"}>
      <button type="button" className="sheet-scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      {role === "alertdialog" ? (
        <div role="alertdialog" aria-modal="true" {...panelProps}>
          {content}
        </div>
      ) : (
        <div role="dialog" aria-modal="true" {...panelProps}>
          {content}
        </div>
      )}
    </div>
  );
}
