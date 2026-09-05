import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ThemedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ThemedSelectProps {
  id?: string;
  value: string;
  options: ThemedSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A compact, keyboard-operable select with the product's own surface and menu styling. */
export function ThemedSelect({
  id,
  value,
  options,
  onValueChange,
  placeholder = "Select an option",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: ThemedSelectProps) {
  const label = options.find((option) => option.value === value)?.label ?? placeholder;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "group flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-left text-sm text-[var(--color-foreground)] shadow-sm transition-colors hover:border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-input))] hover:bg-[var(--color-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xl shadow-black/35 outline-none"
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-8 cursor-pointer select-none items-center rounded px-8 py-1.5 text-sm text-[var(--color-secondary-foreground)] outline-none transition-colors data-[highlighted]:bg-[var(--color-primary)]/15 data-[highlighted]:text-[var(--color-foreground)] data-[state=checked]:bg-[var(--color-primary)]/10 data-[state=checked]:text-[var(--color-foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
              >
                <DropdownMenu.ItemIndicator className="absolute left-2.5 inline-flex h-4 w-4 items-center justify-center text-[var(--color-primary)]">
                  <Check className="h-3.5 w-3.5" />
                </DropdownMenu.ItemIndicator>
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
