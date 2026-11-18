import type { LucideIcon } from "lucide-react";

/**
 * The icon-and-title row that opens each box under a lesson. The notes box and
 * the discussion share it so the two read as a pair.
 */
export function PanelHeading({
  icon: Icon,
  id,
  children,
}: {
  icon: LucideIcon;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h2 id={id} className="font-semibold">
        {children}
      </h2>
    </div>
  );
}
