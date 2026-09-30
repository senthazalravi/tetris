import { create } from "zustand";

export type ThemeChoice = "system" | "dark" | "light";

function resolve(choice: ThemeChoice): "dark" | "light" {
  if (choice !== "system") return choice;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(choice: ThemeChoice) {
  const theme = resolve(choice);
  document.documentElement.setAttribute("data-theme", theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#08090b" : "#f1eee6");
}

function initial(): ThemeChoice {
  try {
    const v = localStorage.getItem("lop-theme");
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    /* storage blocked */
  }
  return "system";
}

interface ThemeState {
  choice: ThemeChoice;
  resolved: "dark" | "light";
  setChoice(c: ThemeChoice): void;
  toggle(): void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  choice: initial(),
  resolved: resolve(initial()),
  setChoice(choice) {
    try {
      localStorage.setItem("lop-theme", choice);
    } catch {
      /* ignore */
    }
    apply(choice);
    set({ choice, resolved: resolve(choice) });
  },
  toggle() {
    get().setChoice(get().resolved === "dark" ? "light" : "dark");
  },
}));

matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  const { choice } = useTheme.getState();
  if (choice === "system") {
    apply("system");
    useTheme.setState({ resolved: resolve("system") });
  }
});

apply(useTheme.getState().choice);
