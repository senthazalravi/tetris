import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/state/theme";
import { IconButton } from "./kit";

export function ThemeButton() {
  const { resolved, toggle } = useTheme();
  return (
    <IconButton label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </IconButton>
  );
}
