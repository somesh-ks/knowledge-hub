// The theme this device chose, before the select is drawn; settingsPage.ts keeps it from then on.
// The select draws no value until a choice is in it (settings.css), so without this a stored Dark
// waited for the page's script before the row showed anything.
try {
  const theme = JSON.parse(localStorage.getItem("singularity:preferences") ?? "null")?.theme;
  const select = document.getElementById("settings-theme");
  if (select && [...select.options].some((option) => option.value === theme)) {
    select.value = theme;
    select.dataset.set = "";
  }
} catch {}
