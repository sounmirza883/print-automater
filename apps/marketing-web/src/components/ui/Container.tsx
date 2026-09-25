import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ContainerProps = HTMLAttributes<HTMLElement> & { as?: ElementType };

/** max-w-7xl, 16px mobile gutter. */
export function Container({ as: Tag = "div", className, ...rest }: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...rest} />
  );
}
