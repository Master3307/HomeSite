<div class="language-picker">
    <label for="language-select">
        <span class="material-symbols-outlined">language</span>
    </label>

    <select id="language-select" onchange="switchLanguage(this.value)">
    </select>
</div>

// language selector
const LANGUAGE_KEY = "preferredLanguage";
let availableLanguages = [];

function isValidLanguage(lang) {
  return availableLanguages.includes(lang);
}

function getPathLanguage(path) {
  const parts = path.split("/").filter(Boolean);
  return parts.length && isValidLanguage(parts[0]) ? parts[0] : null;
}

function buildLanguagePath(path, lang) {
  const parts = path.split("/").filter(Boolean);

  if (parts.length && isValidLanguage(parts[0])) {
    parts[0] = lang;
  } else {
    parts.unshift(lang);
  }

  return "/" + parts.join("/");
}


//     Need to rework anyways   //
//////////////////////////////////
function switchLanguage(lang) {
    if (!isValidLanguage(lang)) return;

    localStorage.setItem(LANGUAGE_KEY, lang);

    const newPath = buildLanguagePath(window.location.pathname, lang);
    const target = newPath + window.location.search + window.location.hash;

    if (target !== window.location.pathname + window.location.search + window.location.hash) {
        window.location.href = target;
    }
}

async function initLanguagePicker() {
    const select = document.getElementById("language-select");
    if (!select) return;

    const path = window.location.pathname;
    const savedLang = localStorage.getItem(LANGUAGE_KEY);

    try {
        const response = await fetch("/assets/i18n/lang-options.json");
        if (!response.ok) {
            throw new Error(`Failed to load languages: ${response.status}`);
        }

        const languages = await response.json();
        if (!Array.isArray(languages) || languages.length === 0) {
            throw new Error("Language list is empty");
        }

        availableLanguages = languages.map(({ value: code }) => code);

        select.innerHTML = "";

        languages.forEach(({ value: code, label }) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = label;
            select.add(option);
        });

        const currentLang = getPathLanguage(path);
        const fallbackLang = isValidLanguage("en") ? "en" : availableLanguages[0];
        const activeLang =
            currentLang ||
            (savedLang && isValidLanguage(savedLang) ? savedLang : null) ||
            fallbackLang;

        if (!currentLang) {
            const normalized = buildLanguagePath(path, activeLang) + window.location.search + window.location.hash;
            window.location.replace(normalized);
            return;
        }

        select.value = activeLang;
        select.addEventListener("change", (e) => {
            switchLanguage(e.target.value);
        });
    } catch (error) {
        console.error("Failed to load language options:", error);
    }
}

document.addEventListener("DOMContentLoaded", initLanguagePicker);
