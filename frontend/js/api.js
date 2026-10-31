// =====================================================================
// PARTLENS REST API CLIENT (Backend /api/*)
// =====================================================================

const CTApi = {
async getStatus() {
const res = await fetch('/api/status');
return res.json();
},

async getHealth() {
const res = await fetch('/api/health');
return res.json();
},

async getLlmSettings() {
const res = await fetch('/api/settings/llm');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
return res.json();
},

async saveLlmSettings(settings) {
const res = await fetch('/api/settings/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
return res.json();
},

async getDatasetStats() {
const res = await fetch('/api/dataset/stats');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
return res.json();
},

async getDatasetSamples(params = {}) {
const q = new URLSearchParams(params);
const res = await fetch(`/api/dataset/samples?${q.toString()}`);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
return res.json();
},

async deleteDatasetSample(filename) {
const res = await fetch(`/api/dataset/sample/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
});
return res.json();
},

async bulkDeleteDatasetSamples(filenames) {
const res = await fetch('/api/dataset/samples/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames })
});
return res.json();
},

async saveDatasetSample(payload) {
    return fetch('/api/dataset/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
},

async getFootprints(query = '', category = '') {
const q = new URLSearchParams();
if (query) q.set('q', query);
if (category) q.set('category', category);
const res = await fetch(`/api/footprints/list?${q.toString()}`);
return res.json();
},

async getImportSources() {
const res = await fetch('/api/dataset/import/sources');
return res.json();
},

async startImport(payload) {
const res = await fetch('/api/dataset/import/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
});
return res.json();
},

async getImportStatus() {
const res = await fetch('/api/dataset/import/status');
return res.json();
},

async abortImport() {
const res = await fetch('/api/dataset/import/abort', { method: 'POST' });
return res.json();
}
};
