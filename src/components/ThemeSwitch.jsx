<div class="theme-picker">
    <label for="theme-select">
    <span id="theme-icon" class="material-symbols-outlined">dark_mode</span>
    </label>

    <select id="theme-select" onchange="switchTheme(this.value)">
    <option value="dark">Dark</option>
    <option value="light">Light</option>
    </select>
</div>



// theme picker
const THEME_KEY = "preferredTheme";

function updateThemeIcon(theme) {
  const icon = document.getElementById("theme-icon");
  if (!icon) return;

  icon.textContent = theme === "light" ? "light_mode" : "dark_mode";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

function switchTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("theme-select");
  const savedTheme = localStorage.getItem(THEME_KEY);
  const theme = savedTheme === "light" ? "light" : "dark";

  applyTheme(theme);

  if (select) {
    select.value = theme;
  }
});