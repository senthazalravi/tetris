// Applies the saved theme before first paint to avoid a flash. Kept as a
// separate file so the CSP can stay free of 'unsafe-inline' for scripts.
(function () {
  try {
    var t = localStorage.getItem("tetris-theme") || "system";
    if (t === "system") {
      t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
