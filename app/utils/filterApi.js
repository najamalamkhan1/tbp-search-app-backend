const jsonHeaders = { "Content-Type": "application/json" };

export const FILTER_TYPES = [
  { label: "Availability", value: "availability" },
  { label: "Price", value: "price" },
  { label: "Product type", value: "product_type" },
  { label: "Vendor", value: "vendor" },
  { label: "Tag", value: "tag" },
  { label: "Collection", value: "collection" },
  { label: "Variant option", value: "variant_option" },
  { label: "Color swatch", value: "color_swatch" },
  { label: "Metafield boolean", value: "metafield_boolean" },
  { label: "Metafield text", value: "metafield_text" },
  { label: "Metafield list", value: "metafield_list" }
];

export const VISIBILITY_OPTIONS = [
  { label: "Visible", value: "visible" },
  { label: "Hidden", value: "hidden" }
];

export const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" }
];

const trimBase = (baseUrl = "") => String(baseUrl || "").replace(/\/$/, "");

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = data.error || data.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.errors = data.errors || {};
    throw error;
  }
  return data;
}

export async function getFilters({ apiBaseUrl = "", shop, search = "", status = "", visibility = "", publicOnly = false }) {
  const params = new URLSearchParams({ shop });
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (visibility) params.set("visibility", visibility);
  if (publicOnly) params.set("public", "true");

  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters?${params.toString()}`);
  return parseResponse(response);
}

export async function getFilter({ apiBaseUrl = "", id }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/${id}`);
  return parseResponse(response);
}

export async function createFilter({ apiBaseUrl = "", payload }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

export async function updateFilter({ apiBaseUrl = "", id, payload }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/${id}`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

export async function deleteFilter({ apiBaseUrl = "", id }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/${id}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function updateFilterStatus({ apiBaseUrl = "", id, status }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/${id}/status`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ status })
  });
  return parseResponse(response);
}

export async function updateFilterVisibility({ apiBaseUrl = "", id, visibility }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/${id}/visibility`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ visibility })
  });
  return parseResponse(response);
}

export async function reorderFilters({ apiBaseUrl = "", shop, items }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/reorder`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ shop, items })
  });
  return parseResponse(response);
}

export async function bulkDeleteFilters({ apiBaseUrl = "", shop, ids }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/bulk-delete`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ shop, ids })
  });
  return parseResponse(response);
}

export async function bulkUpdateFilterStatus({ apiBaseUrl = "", shop, ids, status }) {
  const response = await fetch(`${trimBase(apiBaseUrl)}/api/filters/bulk-status`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ shop, ids, status })
  });
  return parseResponse(response);
}
