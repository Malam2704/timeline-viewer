self.onmessage = async function(e) {
  const url = e.data;
  try {
    self.postMessage({ type: 'progress', message: 'Fetching file...' });
    const response = await fetch(url);
    if (!response.ok) throw new Error('Fetch failed: ' + response.status);
    self.postMessage({ type: 'progress', message: 'Reading file...' });
    const text = await response.text();
    self.postMessage({ type: 'progress', message: 'Parsing JSON...' });
    const json = JSON.parse(text);
    self.postMessage({ type: 'done', data: json });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};