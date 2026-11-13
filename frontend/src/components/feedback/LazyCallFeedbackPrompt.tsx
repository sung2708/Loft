"use client";

import dynamic from "next/dynamic";

/** Reads sessionStorage, so it renders client-side only (no hydration mismatch). */
export const LazyCallFeedbackPrompt = dynamic(
  () => import("./CallFeedbackPrompt").then((module) => module.CallFeedbackPrompt),
  { ssr: false },
);
