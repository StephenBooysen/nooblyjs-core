const API_BASE = 'http://localhost:3000/api/caching';

// Check the API Caching status endpoint
async function getStatus() {
  try {
    const response = await fetch(`${API_BASE}/status`);
    return await response.json();
  } catch (err) {
    console.error('Status error:', err);
    return null;
  }
}

// POST a cache record for a key
async function putCache(key, data) {
  try {
    const response = await fetch(`${API_BASE}/put/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/text' },
      body: JSON.stringify(data)
    });
    return await response.text();
  } catch (err) {
    console.error('Put error:', err);
    return null;
  }
}

// Get a cache record for a key
async function getCache(key) {
  try {
    const response = await fetch(`${API_BASE}/get/${encodeURIComponent(key)}`);
    return await response.text();
  } catch (err) {
    console.error('Get error:', err);
    return null;
  }
}

// Delete a cache record for a key
async function deleteCache(key) {
  try {
    const response = await fetch(`${API_BASE}/delete/${encodeURIComponent(key)}`, {
      method: 'DELETE'
    });
    return await response.text();
  } catch (err) {
    console.error('Delete error:', err);
    return null;
  }
}

console.log('Caching API Base:', API_BASE);
getStatus().then(status => console.log('Caching Status:', status));
