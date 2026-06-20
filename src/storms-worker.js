self.addEventListener('message', async () => {
  try {
    const response = await fetch('data/storms.json');
    if (!response.ok) throw new Error(`storms.json returned ${response.status}`);
    const storms = await response.json();
    self.postMessage({ ok: true, storms });
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
});
