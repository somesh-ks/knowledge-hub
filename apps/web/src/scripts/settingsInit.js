// The theme and style this device chose, before the selects are drawn; settingsPage.ts keeps it from then on.
// The select draws no value until a choice is in it (settings.css), so without this a stored Dark
// waited for the page's script before the row showed anything.
try {
  const stored = JSON.parse(localStorage.getItem("singularity:preferences") ?? "null");
  for (const [id, value] of [
    ["settings-theme", stored?.theme],
    ["settings-style", stored?.style ?? "default"],
  ]) {
    const select = document.getElementById(id);
    if (select && [...select.options].some((option) => option.value === value)) {
      select.value = value;
      select.dataset.set = "";
    }
  }
} catch {}
