const BASE = import.meta.env.VITE_API_URL || "";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("Can't reach the server. Is the FastAPI backend running on port 8000?");
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(formatError(body) || `Request failed (${res.status})`);
  }
  return body;
}

// FastAPI validation errors come back as a list; turn them into one readable line.
function formatError(body) {
  if (!body) return null;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail
      .map((d) => `${d.loc.filter((x) => x !== "body").join(" › ")}: ${d.msg}`)
      .join("; ");
  }
  return null;
}

export const api = {
  health: () => request("/api/health"),
  sample: () => request("/api/sample"),
  generate: (input, save) =>
    request(`/api/generate${save ? "?save=true" : ""}`, { method: "POST", body: JSON.stringify(input) }),
  save: (input, result) =>
    request("/api/timetables", { method: "POST", body: JSON.stringify({ input, result }) }),
  list: () => request("/api/timetables"),
  get: (id) => request(`/api/timetables/${id}`),
  remove: (id) => request(`/api/timetables/${id}`, { method: "DELETE" }),
};
