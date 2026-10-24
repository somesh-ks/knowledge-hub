// Saved keys were dispatch:* until D179: each moves once, before anything reads it.
for (const name of ["localStorage", "sessionStorage"]) {
  try {
    const saved = window[name];
    for (const key of Object.keys(saved)) {
      if (!key.startsWith("dispatch:")) continue;
      const next = `singularity:${key.slice(9)}`;
      if (saved.getItem(next) === null) saved.setItem(next, saved.getItem(key) ?? "");
      saved.removeItem(key);
    }
  } catch {}
}
