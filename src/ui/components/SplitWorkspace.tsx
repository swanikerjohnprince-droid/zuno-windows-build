import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SplitOrientation = "vertical" | "horizontal";

interface SplitWorkspaceProps {
  orientation: SplitOrientation;
  first: ReactNode;
  second: ReactNode;
}

export function SplitWorkspace({ orientation, first, second }: SplitWorkspaceProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 gap-2 overflow-hidden",
        orientation === "vertical" ? "flex-row" : "flex-col",
      )}
    >
      <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-background">
        {first}
      </section>
      <div
        aria-hidden="true"
        className={cn(
          "shrink-0 bg-white/10",
          orientation === "vertical" ? "w-px" : "h-px",
        )}
      />
      <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-background">
        {second}
      </section>
    </div>
  );
}
