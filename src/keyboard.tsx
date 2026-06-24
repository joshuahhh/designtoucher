import { useEffect } from "react";

export type KeyBinding = {
  combo: string;
  action: (e: KeyboardEvent) => void;
};

export type ParsedKeyCombo = {
  key: string;
  ctrlCmd: boolean;
  shift: boolean;
  alt: boolean;
}[];

function parse_key_combo(combo: string): ParsedKeyCombo {
  return combo
    .replaceAll(" ", "")
    .split(",")
    .map((combo_part) => {
      const parts = combo_part.split("+");
      const key = parts.at(-1)!;
      const modifiers = parts.slice(0, -1);
      return {
        key,
        ctrlCmd: modifiers.includes("c"),
        shift: modifiers.includes("s"),
        alt: modifiers.includes("a"),
      };
    });
}

function event_matches_key_combo(e: KeyboardEvent, combo: ParsedKeyCombo) {
  return combo.some(
    (combo_part) =>
      e.key.toLowerCase() === combo_part.key.toLowerCase() &&
      (e.ctrlKey || e.metaKey) === combo_part.ctrlCmd &&
      e.shiftKey === combo_part.shift &&
      e.altKey === combo_part.alt,
  );
}

export function event_matches(e: KeyboardEvent, combo: string) {
  return event_matches_key_combo(e, parse_key_combo(combo));
}

export function useKeyBindings(bindings: KeyBinding[]) {
  useEffect(() => {
    const on_keydown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement)
      )
        return;
      for (const command of bindings) {
        if (event_matches(e, command.combo)) {
          command.action(e);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", on_keydown);
    return () => window.removeEventListener("keydown", on_keydown);
  }, [bindings]);
}
