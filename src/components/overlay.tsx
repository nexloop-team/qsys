"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

// Phone guidelines these follow (Material, Apple HIG, NN/g):
// - Panels and dialogs open as bottom sheets on phones (thumb reach; the keyboard doesn't push a
//   centred box around) and never cover the whole screen.
// - The phone's Back button closes the sheet instead of leaving the page.
// - The close button is a full 44px touch target; the iPhone home bar never covers content.

// Back button closes the overlay: opening adds a history entry for the same address; Back
// (or a swipe-back) pops it and closes. Closing any other way removes that entry again.
//
// One overlay often closes as the next opens (End & bill closes the station panel and opens the
// bill). The closing one's history.back() lands a moment later, and must not be taken for the
// player pressing Back, or it would shut the overlay that just opened. So our own backs are
// counted, their popstate events are ignored, and a new overlay waits for them before it pushes.
let ownBacks = 0;
let lastPopWasOurs = false;
let waiting: (() => void)[] = [];
let safety: number | undefined;

function flushWaiting() {
  const run = waiting;
  waiting = [];
  run.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  // Registered before any overlay's own listener, so it runs first on every popstate.
  window.addEventListener("popstate", () => {
    lastPopWasOurs = ownBacks > 0;
    if (ownBacks > 0 && --ownBacks === 0) {
      window.clearTimeout(safety);
      flushWaiting();
    }
  });
}

function ourBack() {
  ownBacks += 1;
  window.history.back();
  // If the browser never answers (no entry to go back to), don't keep new overlays waiting.
  window.clearTimeout(safety);
  safety = window.setTimeout(() => {
    ownBacks = 0;
    flushWaiting();
  }, 600);
}

function whenHistorySettled(fn: () => void) {
  if (ownBacks === 0) fn();
  else waiting.push(fn);
}

/**
 * Go to another address right after closing an overlay. Closing steps Back in history a moment
 * later; navigating before that lands would be undone by it.
 */
export function afterOverlayClose(fn: () => void) {
  window.setTimeout(() => whenHistorySettled(fn), 50);
}

function useBackToClose(open: boolean, onOpenChange: (open: boolean) => void) {
  const close = useRef(onOpenChange);
  useEffect(() => {
    close.current = onOpenChange;
  });

  useEffect(() => {
    if (!open) return;
    const key = Math.random().toString(36).slice(2);
    const openedAt = window.location.href;
    let pushed = false;
    let cancelled = false;
    let poppedByBack = false;
    const push = () => {
      if (cancelled) return;
      window.history.pushState({ ...window.history.state, qsOverlay: key }, "");
      pushed = true;
    };
    // Deferred, so React's development double-mount doesn't push twice.
    const timer = window.setTimeout(() => whenHistorySettled(push), 0);
    const onPop = () => {
      // Another overlay tidying its own entry away, not the Back button.
      if (lastPopWasOurs || !pushed) return;
      // Still on (or above) our entry: a sheet opened on top of this one went back, not us.
      if (window.history.state?.qsOverlay === key) return;
      poppedByBack = true;
      close.current(false);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      // Closed with the X, Escape or a button: take our entry back off the history.
      // Not after moving to another page, or Back would undo that move.
      if (pushed && !poppedByBack && window.history.state?.qsOverlay === key && window.location.href === openedAt) ourBack();
    };
  }, [open]);
}

const CLOSE =
  "-mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg pointer-coarse:size-11";

function Grabber() {
  // Drag-handle look: says "this is a sheet" on phones. Decorative.
  return <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-line-strong md:hidden" />;
}

// Right-hand slide-over on desktop, bottom sheet on phones.
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useBackToClose(open, onOpenChange);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <D.Content
          className={cx(
            "fixed z-50 flex flex-col border-line bg-panel shadow-pop outline-none",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t",
            "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[440px] md:rounded-none md:border-t-0 md:border-l",
          )}
        >
          <Grabber />
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-2 md:py-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-0.5 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">Details</D.Description>
              )}
            </div>
            <D.Close className={CLOSE} aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            {children}
          </div>
          {footer && (
            <footer className="border-t border-line px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">{footer}</footer>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// Centred dialog on larger screens; a bottom sheet on phones.
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useBackToClose(open, onOpenChange);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <D.Content
          className={cx(
            "fixed z-50 flex flex-col border-line bg-panel shadow-pop outline-none",
            // Phone: bottom sheet.
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t",
            // Larger screens: centred card.
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border",
            wide ? "sm:max-w-2xl" : "sm:max-w-md",
          )}
        >
          <Grabber />
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-2 sm:py-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-0.5 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">Dialog</D.Description>
              )}
            </div>
            <D.Close className={CLOSE} aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </header>
          <div className="overflow-y-auto overscroll-contain px-5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// The main action(s) of a sheet or dialog, pinned to the bottom of the scrolling area so they
// stay in thumb reach however long the form above them is.
export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "sticky bottom-0 z-10 -mx-5 -mb-[calc(16px+env(safe-area-inset-bottom))] mt-1 border-t border-line bg-panel px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
