(function () {
  try {
    var theme = localStorage.getItem("loft.theme") || "system";
    var dark =
      theme === "dark" ||
      (theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.add(dark ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.classList.add("dark");
  }
})();
